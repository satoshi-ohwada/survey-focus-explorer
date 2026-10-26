/**
 * レポート出力（A4・2枚サマリーレポート）生成モジュール
 * 母集団情報、ワードクラウド、共起ネットワーク、UMAP散布図、属性クロス集計を
 * A4縦2ページに最適化してレイアウトし、プレビュー表示および高品位PDF/印刷出力を提供する
 */
const ReportGenerator = {
    modalId: 'reportPreviewModal',
    memoText: '',

    init() {
        this.bindEvents();
    },

    bindEvents() {
        const modal = document.getElementById(this.modalId);
        if (!modal) return;

        // 閉じるボタン
        const btnClose = document.getElementById('btnCloseReportModal');
        if (btnClose) {
            btnClose.addEventListener('click', () => this.closePreview());
        }
        const btnCloseBottom = document.getElementById('btnCloseReportBottom');
        if (btnCloseBottom) {
            btnCloseBottom.addEventListener('click', () => this.closePreview());
        }

        // 印刷ボタン
        const btnPrint = document.getElementById('btnExecutePrint');
        if (btnPrint) {
            btnPrint.addEventListener('click', () => this.executePrint());
        }

        // モーダル外クリックで閉じる
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.closePreview();
            }
        });
    },

    /**
     * レポートプレビューを開く
     */
    async openPreview() {
        // データチェック
        if (!AppState.rawRows || AppState.rawRows.length === 0) {
            if (typeof showToast === 'function') {
                showToast('⚠️ 分析データがありません。先にデータを読み込んでください。');
            }
            return;
        }

        if (!AppState.subcorpusStats || !AppState.filterResult) {
            if (typeof showToast === 'function') {
                showToast('⚠️ 分析結果がまだありません。キーワードを指定して分析を実行してください。');
            }
            return;
        }

        // ローディングトースト
        if (typeof showToast === 'function') {
            showToast('⏳ レポート用画像と集計表を生成中...');
        }

        try {
            // 1. 各Visualizerの状態を確実に同期・画像取得
            const images = await this.captureVisualizations();

            // 2. 母集団＆集計データの構築
            const reportData = this.buildReportData();

            // 3. HTMLテンプレートの組み立て
            const html = this.generateHtml(reportData, images);

            // 4. モーダルに注入して表示
            const container = document.getElementById('reportPagesContainer');
            if (container) {
                container.innerHTML = html;
            }

            const modal = document.getElementById(this.modalId);
            if (modal) {
                modal.style.display = 'flex';
                document.body.style.overflow = 'hidden'; // 背景スクロール固定
            }

            // メモ入力欄のリアルタイム反映イベント
            const memoTextarea = document.getElementById('reportInputMemo');
            const memoPrintView = document.getElementById('reportPrintMemo');
            if (memoTextarea && memoPrintView) {
                if (this.memoText) {
                    memoTextarea.value = this.memoText;
                    memoPrintView.textContent = this.memoText;
                }
                memoTextarea.addEventListener('input', (e) => {
                    this.memoText = e.target.value;
                    memoPrintView.textContent = e.target.value || '（特記事項なし）';
                });
            }

        } catch (err) {
            console.error('Report generation error:', err);
            if (typeof showToast === 'function') {
                showToast('⚠️ レポートの生成中にエラーが発生しました');
            }
        }
    },

    /**
     * プレビューを閉じる
     */
    closePreview() {
        const modal = document.getElementById(this.modalId);
        if (modal) {
            modal.style.display = 'none';
            document.body.style.overflow = '';
        }
    },

    /**
     * 印刷ダイアログの起動
     */
    executePrint() {
        window.print();
    },

    /**
     * 4大可視化の画像スナップショットを並列/順次取得
     */
    async captureVisualizations() {
        const imgW = 1200;
        const imgH = 900;

        // --- 1. ワードクラウド ---
        let cloudImg = '';
        try {
            if (!WordCloudVisualizer.currentWords || WordCloudVisualizer.currentWords.length === 0) {
                if (typeof updateWordCloud === 'function') updateWordCloud();
            }
            if (typeof WordCloudVisualizer.getExportCanvas === 'function') {
                const cCanvas = await WordCloudVisualizer.getExportCanvas(imgW, imgH);
                if (cCanvas) cloudImg = cCanvas.toDataURL('image/png');
            }
        } catch (e) {
            console.warn('Failed to capture cloud canvas:', e);
        }

        // --- 2. 共起ネットワーク ---
        let networkImg = '';
        try {
            if (!NetworkVisualizer.nodes || NetworkVisualizer.nodes.length === 0) {
                if (typeof updateNetwork === 'function') updateNetwork();
            }
            if (typeof NetworkVisualizer.getExportCanvas === 'function') {
                const nCanvas = NetworkVisualizer.getExportCanvas(imgW, imgH);
                if (nCanvas) networkImg = nCanvas.toDataURL('image/png');
            }
        } catch (e) {
            console.warn('Failed to capture network canvas:', e);
        }

        // --- 3. UMAP散布図 ---
        let umapImg = '';
        try {
            if (!UmapVisualizer.points || UmapVisualizer.points.length === 0) {
                if (typeof updateUmap === 'function') updateUmap();
            }
            if (typeof UmapVisualizer.getExportCanvas === 'function') {
                const uCanvas = UmapVisualizer.getExportCanvas(imgW, imgH);
                if (uCanvas) umapImg = uCanvas.toDataURL('image/png');
            }
        } catch (e) {
            console.warn('Failed to capture UMAP canvas:', e);
        }

        // --- 4. 属性クロス集計 ---
        let attrImg = '';
        if (AppState.attrCol && typeof Plotly !== 'undefined') {
            try {
                const targetRows = (typeof getFilteredRows === 'function') ? getFilteredRows() : AppState.rawRows;
                const matchedDocs = (AppState.filterResult && AppState.filterResult.matchedDocs) ? AppState.filterResult.matchedDocs : [];
                const isFiltered = targetRows.length < (AppState.rawRows || []).length;

                if (typeof AttrChartVisualizer.getExportImage === 'function') {
                    attrImg = await AttrChartVisualizer.getExportImage(
                        targetRows,
                        matchedDocs,
                        AppState.attrCol,
                        AppState.targetKeyword,
                        { isFiltered, calcMode: AppState.attrCalcMode || 'rate' },
                        imgW,
                        imgH
                    );
                }

                if (!attrImg) {
                    const container = document.getElementById('attrChartContainer');
                    if (!container || !container.data || container.data.length === 0) {
                        if (typeof updateAttrChart === 'function') updateAttrChart();
                    }
                    attrImg = await Plotly.toImage('attrChartContainer', {
                        format: 'png',
                        width: imgW,
                        height: imgH
                    });
                }
            } catch (e) {
                console.warn('Failed to capture attr chart:', e);
            }
        }

        return { cloudImg, networkImg, umapImg, attrImg };
    },

    /**
     * 母集団情報および各集計テーブルのデータ作成
     */
    buildReportData() {
        const rawRows = AppState.rawRows || [];
        const targetRows = (typeof getFilteredRows === 'function') ? getFilteredRows() : rawRows;
        const matchedDocs = (AppState.filterResult && AppState.filterResult.matchedDocs) ? AppState.filterResult.matchedDocs : [];

        const totalRaw = rawRows.length;
        const totalFiltered = targetRows.length;
        const totalMatched = matchedDocs.length;
        const coverageRate = totalFiltered > 0 ? ((totalMatched / totalFiltered) * 100).toFixed(1) : '0.0';

        // 1. 属性内訳（全体母集団）
        const attrDist = [];
        if (AppState.attrCol) {
            const attrCounts = {};
            targetRows.forEach(r => {
                const v = r[AppState.attrCol] != null && String(r[AppState.attrCol]).trim() !== ''
                    ? String(r[AppState.attrCol]).trim()
                    : '（未回答・不明）';
                attrCounts[v] = (attrCounts[v] || 0) + 1;
            });
            Object.entries(attrCounts).forEach(([cat, count]) => {
                const pct = totalFiltered > 0 ? ((count / totalFiltered) * 100).toFixed(1) : '0.0';
                attrDist.push({ category: cat, count, pct });
            });
            attrDist.sort((a, b) => b.count - a.count);
        }

        // 2. 頻出単語 Top 10
        const wordList = (AppState.subcorpusStats && AppState.subcorpusStats.wordList) ? AppState.subcorpusStats.wordList : [];
        const topWords = wordList.slice(0, 10).map((w, idx) => {
            const rate = totalMatched > 0 ? ((w.count / totalMatched) * 100).toFixed(1) : '0.0';
            return {
                rank: idx + 1,
                word: w.text,
                count: w.count,
                rate: rate
            };
        });

        // 3. 主要共起ペア Top 6
        const coocCounts = (AppState.subcorpusStats && AppState.subcorpusStats.coocCounts) ? AppState.subcorpusStats.coocCounts : {};
        const coocPairs = [];
        for (const [key, count] of Object.entries(coocCounts)) {
            const [w1, w2] = key.split('|||');
            if (w1 && w2 && count > 0) {
                coocPairs.push({ w1, w2, count });
            }
        }
        coocPairs.sort((a, b) => b.count - a.count);
        const topCoocPairs = coocPairs.slice(0, 6).map((cp, idx) => ({
            rank: idx + 1,
            pair: `${cp.w1} × ${cp.w2}`,
            count: cp.count
        }));

        // 4. 属性別クロス集計データ
        const attrCrossTable = [];
        if (AppState.attrCol && attrDist.length > 0) {
            const matchedByAttr = {};
            matchedDocs.forEach(d => {
                const val = d.attribute && d.attribute.trim() !== '' ? d.attribute.trim() : '（未回答・不明）';
                matchedByAttr[val] = (matchedByAttr[val] || 0) + 1;
            });

            attrDist.forEach(ad => {
                const mCount = matchedByAttr[ad.category] || 0;
                // 言及率: 当該属性内でのキーワード言及率
                const mRate = ad.count > 0 ? ((mCount / ad.count) * 100).toFixed(1) : '0.0';
                // 構成比: キーワード意見全体における当該属性のシェア
                const mShare = totalMatched > 0 ? ((mCount / totalMatched) * 100).toFixed(1) : '0.0';
                attrCrossTable.push({
                    category: ad.category,
                    popCount: ad.count,
                    matchedCount: mCount,
                    rate: mRate,
                    share: mShare
                });
            });
            // 言及率の高い順にソート
            attrCrossTable.sort((a, b) => parseFloat(b.rate) - parseFloat(a.rate));
        }

        // 5. UMAPクラスタ傾向
        const clustersSummary = [];
        if (UmapVisualizer && UmapVisualizer.clusters && UmapVisualizer.clusters.length > 0) {
            UmapVisualizer.clusters.slice(0, 4).forEach((c, idx) => {
                const topKw = (c.topWords || []).slice(0, 4).join(', ');
                clustersSummary.push({
                    id: idx + 1,
                    label: c.label || `グループ ${idx + 1}`,
                    size: c.size || 0,
                    topKw: topKw || '（代表語彙なし）'
                });
            });
        }

        const now = new Date();
        const dateStr = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

        return {
            dateStr,
            fileName: AppState.fileName || 'data.csv',
            targetKeyword: AppState.targetKeyword || '（全体分析）',
            resolvedWord: AppState.resolvedTargetWord || '',
            textCol: AppState.textCol || '（テキスト列）',
            attrCol: AppState.attrCol || '（属性列未設定）',
            totalRaw,
            totalFiltered,
            totalMatched,
            coverageRate,
            attrDist: attrDist.slice(0, 6),
            topWords,
            topCoocPairs,
            attrCrossTable: attrCrossTable.slice(0, 6),
            clustersSummary
        };
    },

    /**
     * A4・2ページのHTMLを生成する
     */
    generateHtml(data, images) {
        // 属性サマリーHTML
        let attrSummaryHtml = '';
        if (data.attrDist && data.attrDist.length > 0) {
            attrSummaryHtml = `
                <div class="report-attr-pill-row">
                    <span class="report-attr-title">属性内訳:</span>
                    ${data.attrDist.map(a => `
                        <span class="report-attr-tag"><b>${this.escape(a.category)}</b>: ${a.count.toLocaleString()}件 (${a.pct}%)</span>
                    `).join('')}
                </div>
            `;
        }

        // 頻出単語テーブル行
        const topWordsRows = data.topWords.map(w => `
            <tr>
                <td style="text-align: center; font-weight: 700; color: #475569;">${w.rank}</td>
                <td style="font-weight: 600; color: #1e293b;">${this.escape(w.word)}</td>
                <td style="text-align: right; color: #334155;">${w.count.toLocaleString()} 件</td>
                <td style="text-align: right; color: #2563eb; font-weight: 600;">${w.rate}%</td>
            </tr>
        `).join('');

        // 共起ペアテーブル行
        const coocRows = data.topCoocPairs.length > 0 ? data.topCoocPairs.map(cp => `
            <tr>
                <td style="text-align: center; font-weight: 700; color: #475569;">${cp.rank}</td>
                <td style="font-weight: 600; color: #1e293b;">${this.escape(cp.pair)}</td>
                <td style="text-align: right; color: #0284c7; font-weight: 600;">${cp.count.toLocaleString()} 回</td>
            </tr>
        `).join('') : `<tr><td colspan="3" style="text-align:center; color:#94a3b8; padding: 12px;">共起データがありません</td></tr>`;

        // 属性クロス集計テーブル行
        const attrCrossRows = data.attrCrossTable.length > 0 ? data.attrCrossTable.map(ac => `
            <tr>
                <td style="font-weight: 600; color: #1e293b;">${this.escape(ac.category)}</td>
                <td style="text-align: right; color: #64748b;">${ac.popCount.toLocaleString()}</td>
                <td style="text-align: right; color: #334155; font-weight: 600;">${ac.matchedCount.toLocaleString()}</td>
                <td style="text-align: right; color: #2563eb; font-weight: 700; background: #f0f7ff;">${ac.rate}%</td>
                <td style="text-align: right; color: #475569;">${ac.share}%</td>
            </tr>
        `).join('') : `<tr><td colspan="5" style="text-align:center; color:#94a3b8; padding: 12px;">属性列が未選択です</td></tr>`;

        // クラスタ要約リスト
        const clustersHtml = data.clustersSummary.length > 0 ? `
            <div class="report-cluster-list">
                ${data.clustersSummary.map(c => `
                    <div class="report-cluster-item">
                        <div class="report-cluster-header">
                            <span class="report-cluster-badge">Group ${c.id}</span>
                            <span class="report-cluster-label">${this.escape(c.label)}</span>
                            <span class="report-cluster-size">(${c.size}件)</span>
                        </div>
                        <div class="report-cluster-kw">主要語: ${this.escape(c.topKw)}</div>
                    </div>
                `).join('')}
            </div>
        ` : `
            <div style="font-size: 11px; color: #64748b; padding: 8px; background: #f8fafc; border-radius: 4px;">
                💡 意味的・文脈的に類似した発言が近くに集まり、色のまとまり（クラスタ）を形成しています。
            </div>
        `;

        // ページ1 HTML
        const page1 = `
            <div class="report-page" id="reportPage1">
                <!-- ページ1 ヘッダー -->
                <div class="report-header">
                    <div class="report-header-main">
                        <div class="report-title-badge">FOCUS EXPLORER REPORT</div>
                        <h2 class="report-title">アンケート自由記述 分析サマリーレポート</h2>
                    </div>
                    <div class="report-header-meta">
                        <div><b>出力日時:</b> ${data.dateStr}</div>
                        <div><b>対象ファイル:</b> ${this.escape(data.fileName)}</div>
                    </div>
                </div>

                <!-- ターゲットキーワード ＆ 分析条件 -->
                <div class="report-condition-bar">
                    <div class="report-condition-item">
                        <span class="report-condition-lbl">注目キーワード:</span>
                        <span class="report-condition-val-accent">🎯 ${this.escape(data.targetKeyword)}</span>
                        ${data.resolvedWord && data.resolvedWord !== data.targetKeyword ? `<span style="font-size: 11px; color: #64748b;">(代表形: ${this.escape(data.resolvedWord)})</span>` : ''}
                    </div>
                    <div class="report-condition-item">
                        <span class="report-condition-lbl">分析テキスト列:</span>
                        <span class="report-condition-val">📄 ${this.escape(data.textCol)}</span>
                    </div>
                    <div class="report-condition-item">
                        <span class="report-condition-lbl">属性分類列:</span>
                        <span class="report-condition-val">📊 ${this.escape(data.attrCol)}</span>
                    </div>
                </div>

                <!-- 1. 母集団サマリーカード -->
                <div class="report-section">
                    <div class="report-sec-title">📌 1. 母集団・分析規模サマリー</div>
                    <div class="report-kpi-grid">
                        <div class="report-kpi-card">
                            <div class="report-kpi-lbl">全体回答数</div>
                            <div class="report-kpi-val">${data.totalRaw.toLocaleString()} <span class="report-kpi-unit">件</span></div>
                            <div class="report-kpi-sub">取り込みデータ全件</div>
                        </div>
                        <div class="report-kpi-card">
                            <div class="report-kpi-lbl">分析対象件数</div>
                            <div class="report-kpi-val">${data.totalFiltered.toLocaleString()} <span class="report-kpi-unit">件</span></div>
                            <div class="report-kpi-sub">ノイズ除外・絞込後</div>
                        </div>
                        <div class="report-kpi-card accent">
                            <div class="report-kpi-lbl">キーワード該当意見数</div>
                            <div class="report-kpi-val accent">${data.totalMatched.toLocaleString()} <span class="report-kpi-unit">件</span></div>
                            <div class="report-kpi-sub">関連意見・発言の総数</div>
                        </div>
                        <div class="report-kpi-card">
                            <div class="report-kpi-lbl">母集団カバー率</div>
                            <div class="report-kpi-val">${data.coverageRate} <span class="report-kpi-unit">%</span></div>
                            <div class="report-kpi-sub">言及者の全体比率</div>
                        </div>
                    </div>
                    ${attrSummaryHtml}
                </div>

                <!-- 2. ワードクラウド ＆ 共起ネットワーク -->
                <div class="report-section" style="margin-top: 10px;">
                    <div class="report-sec-title">🔍 2. 頻出単語 ＆ 話題共起構造（テキスト全体観）</div>
                    <div class="report-dual-grid">
                        <!-- 左: ワードクラウド -->
                        <div class="report-card">
                            <div class="report-card-title">☁️ 頻出重要単語（ワードクラウド）</div>
                            <div class="report-chart-box">
                                ${images.cloudImg ? `<img src="${images.cloudImg}" class="report-chart-img" alt="ワードクラウド" />` : `<div class="report-no-chart">画像がありません</div>`}
                            </div>
                            <table class="report-table" style="margin-top: 8px;">
                                <thead>
                                    <tr>
                                        <th style="width: 38px; text-align: center;">順位</th>
                                        <th>抽出単語</th>
                                        <th style="width: 65px; text-align: right;">出現件数</th>
                                        <th style="width: 65px; text-align: right;">出現率</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${topWordsRows}
                                </tbody>
                            </table>
                        </div>

                        <!-- 右: 共起ネットワーク -->
                        <div class="report-card">
                            <div class="report-card-title">🕸️ 単語間の結びつき（共起ネットワーク）</div>
                            <div class="report-chart-box">
                                ${images.networkImg ? `<img src="${images.networkImg}" class="report-chart-img" alt="共起ネットワーク" />` : `<div class="report-no-chart">画像がありません</div>`}
                            </div>
                            <table class="report-table" style="margin-top: 8px;">
                                <thead>
                                    <tr>
                                        <th style="width: 38px; text-align: center;">順位</th>
                                        <th>強く共起している単語ペア</th>
                                        <th style="width: 75px; text-align: right;">共起頻度</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${coocRows}
                                </tbody>
                            </table>
                            <div class="report-hint-box" style="margin-top: 8px;">
                                💡 色のまとまりは同一の文脈で語られる話題クラスタを表し、線の太さは共起の強さを示します。
                            </div>
                        </div>
                    </div>
                </div>

                <!-- ページ1 フッター -->
                <div class="report-footer">
                    <span>Survey Focus Explorer - 意見深掘り＆連想分析レポート</span>
                    <span>1 / 2</span>
                </div>
            </div>
        `;

        // ページ2 HTML
        const page2 = `
            <div class="report-page" id="reportPage2">
                <!-- ページ2 ヘッダー -->
                <div class="report-header">
                    <div class="report-header-main">
                        <div class="report-title-badge">FOCUS EXPLORER REPORT (2/2)</div>
                        <h2 class="report-title">意見構造クラスタ ＆ 属性セグメント別分析</h2>
                    </div>
                    <div class="report-header-meta">
                        <div><b>キーワード:</b> ${this.escape(data.targetKeyword)}</div>
                        <div><b>ファイル:</b> ${this.escape(data.fileName)}</div>
                    </div>
                </div>

                <!-- 3. UMAP散布図 -->
                <div class="report-section">
                    <div class="report-sec-title">🌌 3. 意見の類似度・文脈クラスタリング（UMAP散布図）</div>
                    <div class="report-umap-container">
                        <div class="report-umap-chart-box">
                            ${images.umapImg ? `<img src="${images.umapImg}" class="report-chart-img" alt="UMAP散布図" />` : `<div class="report-no-chart">画像がありません</div>`}
                        </div>
                        <div class="report-umap-desc-box">
                            <div class="report-sub-title">主要クラスタの傾向・要約</div>
                            ${clustersHtml}
                        </div>
                    </div>
                </div>

                <!-- 4. 属性クロス集計 -->
                <div class="report-section" style="margin-top: 10px;">
                    <div class="report-sec-title">📊 4. 属性セグメント別クロス集計（言及傾向）</div>
                    <div class="report-dual-grid">
                        <div class="report-card">
                            <div class="report-card-title">属性別 言及率 / 構成比グラフ</div>
                            <div class="report-chart-box" style="height: 190px;">
                                ${images.attrImg ? `<img src="${images.attrImg}" class="report-chart-img" alt="属性グラフ" />` : `<div class="report-no-chart">${data.attrCol !== '（属性列未設定）' ? 'グラフ準備中' : '属性列が未選択です'}</div>`}
                            </div>
                        </div>
                        <div class="report-card">
                            <div class="report-card-title">属性別 集計データ詳細表</div>
                            <table class="report-table">
                                <thead>
                                    <tr>
                                        <th>属性区分</th>
                                        <th style="width: 50px; text-align: right;">母集団</th>
                                        <th style="width: 50px; text-align: right;">言及数</th>
                                        <th style="width: 60px; text-align: right;">言及率%</th>
                                        <th style="width: 55px; text-align: right;">構成比%</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${attrCrossRows}
                                </tbody>
                            </table>
                            <div class="report-hint-box" style="margin-top: 6px;">
                                ※「言及率」は各属性内での該当割合、「構成比」は該当意見全体における属性シェアです。
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 5. 分析所見・考察メモ欄 -->
                <div class="report-section" style="margin-top: 10px;">
                    <div class="report-sec-title">📝 5. 分析所見・考察メモ（報告用）</div>
                    <div class="report-memo-wrapper">
                        <!-- 画面プレビュー時は入力可能 -->
                        <textarea id="reportInputMemo" class="report-memo-input no-print" placeholder="ここに分析結果の要約や所見、考察、ネクストアクションなどを自由に入力できます（印刷時にそのまま反映されます）。">${this.escape(this.memoText)}</textarea>
                        <!-- 印刷時は静的テキストとして印字 -->
                        <div id="reportPrintMemo" class="report-memo-print print-only">${this.escape(this.memoText || '（特記事項なし）')}</div>
                    </div>
                </div>

                <!-- ページ2 フッター -->
                <div class="report-footer">
                    <span>Survey Focus Explorer - 意見深掘り＆連想分析レポート</span>
                    <span>2 / 2</span>
                </div>
            </div>
        `;

        return page1 + page2;
    },

    escape(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
};

// 初期化登録
if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', () => {
        ReportGenerator.init();
    });
}
