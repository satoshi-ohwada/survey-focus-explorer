/**
 * レポート出力（A4・全3枚サマリーレポート）生成モジュール
 * （１）投入したデータ全体の概要
 * （２）指定したキーワードとその関連語と判断した語の概要
 * （３）分析対象の概要
 * （４）要約サマリー（集約概要と代表意見）
 * （５）ワードクラウド
 * （６）共起ネットワーク（特徴語重視、頻度重視）
 * （７）意見分布
 * （８）クロス集計
 * の順にA4縦3ページに最適化してレイアウトし、プレビュー表示および高品位PDF/印刷出力を提供する
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
            // 1. 各Visualizerの状態を確実に同期・画像取得（特徴語重視 & 頻度重視を含む）
            const images = await this.captureVisualizations();

            // 2. 母集団＆集計データの構築
            const reportData = this.buildReportData();

            // 3. HTMLテンプレートの組み立て（全3枚構成）
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
     * 可視化画像のキャプチャ
     * ワードクラウド、共起ネットワーク（特徴度重視 & 頻度重視 & 全体話題構造）、UMAP、属性クロス集計
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

        // --- 2. 結びつきネットワーク（特徴語重視 & 頻度重視 & 全体話題共起） ---
        let networkImg = '';
        let networkImgDistinct = '';
        let networkImgFreq = '';
        let networkImgWord = '';

        try {
            const targetRows = (typeof getFilteredRows === 'function') ? getFilteredRows() : (AppState.rawRows || []);
            const matchedDocs = (AppState.filterResult && AppState.filterResult.matchedDocs) ? AppState.filterResult.matchedDocs : [];
            const activeRelated = (AppState.relatedWords || []).filter(r => r.checked).map(r => r.word);

            // 属性列が存在し、属性ネットワーク機能が利用可能な場合
            if (AppState.attrCol && typeof NetworkVisualizer.getExportCanvasForAttrMetric === 'function') {
                const opt = {
                    resolvedTargetWord: AppState.resolvedTargetWord,
                    maxWords: AppState.networkMaxWords || 40,
                    spacingMode: AppState.networkSpacing || 'wide',
                    fontSize: AppState.networkFontSize || 'large',
                    customStopWords: AppState.customStopWords
                };
                // 特徴度重視（特有語）
                const dCanvas = NetworkVisualizer.getExportCanvasForAttrMetric('distinct', matchedDocs, AppState.attrCol, targetRows, AppState.targetKeyword, opt, imgW, imgH);
                if (dCanvas) networkImgDistinct = dCanvas.toDataURL('image/png');

                // 頻度重視（高頻度語）
                const fCanvas = NetworkVisualizer.getExportCanvasForAttrMetric('freq', matchedDocs, AppState.attrCol, targetRows, AppState.targetKeyword, opt, imgW, imgH);
                if (fCanvas) networkImgFreq = fCanvas.toDataURL('image/png');
            }

            // 単語共起ネットワーク（全体の話題構造）
            if (typeof NetworkVisualizer.getExportCanvasForWordNetwork === 'function') {
                const wordList = (AppState.subcorpusStats && AppState.subcorpusStats.wordList) ? AppState.subcorpusStats.wordList : [];
                const coocCounts = (AppState.subcorpusStats && AppState.subcorpusStats.coocCounts) ? AppState.subcorpusStats.coocCounts : {};
                const optW = {
                    resolvedTargetWord: AppState.resolvedTargetWord,
                    maxWords: AppState.networkMaxWords || 40,
                    spacingMode: AppState.networkSpacing || 'wide',
                    fontSize: AppState.networkFontSize || 'large',
                    colorMode: AppState.networkColorMode || 'community'
                };
                const wCanvas = NetworkVisualizer.getExportCanvasForWordNetwork(wordList, coocCounts, AppState.targetKeyword, activeRelated, optW, imgW, imgH);
                if (wCanvas) networkImgWord = wCanvas.toDataURL('image/png');
            }

            // フォールバック（既存の描画キャンバス）
            if (!networkImgDistinct && !networkImgWord) {
                if (!NetworkVisualizer.nodes || NetworkVisualizer.nodes.length === 0) {
                    if (typeof updateNetwork === 'function') updateNetwork();
                }
                if (typeof NetworkVisualizer.getExportCanvas === 'function') {
                    const nCanvas = NetworkVisualizer.getExportCanvas(imgW, imgH);
                    if (nCanvas) networkImg = nCanvas.toDataURL('image/png');
                }
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
                const targetRows = (typeof getFilteredRows === 'function') ? getFilteredRows() : (AppState.rawRows || []);
                const matchedDocs = (AppState.filterResult && AppState.filterResult.matchedDocs) ? AppState.filterResult.matchedDocs : [];
                const isFiltered = targetRows.length < (AppState.rawRows || []).length;

                if (typeof AttrChartVisualizer !== 'undefined' && typeof AttrChartVisualizer.getExportImage === 'function') {
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

        return { cloudImg, networkImg, networkImgDistinct, networkImgFreq, networkImgWord, umapImg, attrImg };
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

        // 1. 全体データの属性内訳（投入データ全体）
        const attrDistAll = [];
        if (AppState.attrCol) {
            const attrCountsAll = {};
            rawRows.forEach(r => {
                const v = r[AppState.attrCol] != null && String(r[AppState.attrCol]).trim() !== ''
                    ? String(r[AppState.attrCol]).trim()
                    : '（未回答・不明）';
                attrCountsAll[v] = (attrCountsAll[v] || 0) + 1;
            });
            Object.entries(attrCountsAll).forEach(([cat, count]) => {
                const pct = totalRaw > 0 ? ((count / totalRaw) * 100).toFixed(1) : '0.0';
                attrDistAll.push({ category: cat, count, pct });
            });
            attrDistAll.sort((a, b) => b.count - a.count);
        }

        // 2. 分析対象母集団の属性内訳（フィルタ後）
        const attrDistFiltered = [];
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
                attrDistFiltered.push({ category: cat, count, pct });
            });
            attrDistFiltered.sort((a, b) => b.count - a.count);
        }

        // 3. 該当意見における属性内訳（キーワード該当者）
        const attrDistMatched = [];
        if (AppState.attrCol && matchedDocs.length > 0) {
            const matchedCounts = {};
            matchedDocs.forEach(d => {
                const v = d.attribute && d.attribute.trim() !== '' ? d.attribute.trim() : '（未回答・不明）';
                matchedCounts[v] = (matchedCounts[v] || 0) + 1;
            });
            Object.entries(matchedCounts).forEach(([cat, count]) => {
                const pct = totalMatched > 0 ? ((count / totalMatched) * 100).toFixed(1) : '0.0';
                attrDistMatched.push({ category: cat, count, pct });
            });
            attrDistMatched.sort((a, b) => b.count - a.count);
        }

        // 4. 頻出単語 Top 10
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

        // 5. 主要共起ペア Top 6
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

        // 6. 属性別クロス集計データ
        const attrCrossTable = [];
        if (AppState.attrCol && attrDistFiltered.length > 0) {
            const matchedByAttr = {};
            matchedDocs.forEach(d => {
                const val = d.attribute && d.attribute.trim() !== '' ? d.attribute.trim() : '（未回答・不明）';
                matchedByAttr[val] = (matchedByAttr[val] || 0) + 1;
            });

            attrDistFiltered.forEach(ad => {
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

        // 7. 主要な論点グループ（トピックサマリー）
        if ((!AppState.summaryData || !AppState.summaryData.topicSummaries) && typeof generateSummaryData === 'function') {
            generateSummaryData();
        }
        const rawTopicSummaries = (AppState.summaryData && AppState.summaryData.topicSummaries) ? AppState.summaryData.topicSummaries : [];
        const topicSummaries = rawTopicSummaries.slice(0, 4).map((t, idx) => {
            const repOp = (t.representativeOpinions && t.representativeOpinions.length > 0)
                ? t.representativeOpinions[0]
                : null;
            let repText = '';
            let repAttr = '';
            if (repOp) {
                repText = repOp.text ? repOp.text.trim() : '';
                if (repText.length > 120) repText = repText.substring(0, 120) + '…';
                repAttr = repOp.attribute ? repOp.attribute.trim() : '';
            }
            return {
                rank: idx + 1,
                name: t.name || `論点 ${idx + 1}`,
                keywords: (t.keywords || []).slice(0, 5),
                docCount: t.docCount || 0,
                shareRate: t.shareRate || 0,
                primaryType: t.primaryType || '',
                repText: repText,
                repAttr: repAttr
            };
        });

        // 8. UMAPクラスタ傾向
        const clustersSummary = [];
        if (UmapVisualizer && UmapVisualizer.clusters && UmapVisualizer.clusters.length > 0) {
            UmapVisualizer.clusters.slice(0, 5).forEach((c, idx) => {
                const topKw = (c.topWords || []).slice(0, 4).join(', ');
                clustersSummary.push({
                    id: idx + 1,
                    label: c.label || `グループ ${idx + 1}`,
                    size: c.size || 0,
                    topKw: topKw || '（代表語彙なし）'
                });
            });
        }

        // 9. 意見タイプ集約（構成比）
        let opinionTypeSummary = (AppState.summaryData && AppState.summaryData.opinionTypeSummary)
            ? AppState.summaryData.opinionTypeSummary
            : null;
        if (!opinionTypeSummary && typeof generateSummaryData === 'function') {
            generateSummaryData();
            opinionTypeSummary = (AppState.summaryData && AppState.summaryData.opinionTypeSummary)
                ? AppState.summaryData.opinionTypeSummary
                : null;
        }

        // 10. 関連意見に含まれた単語の集計情報
        let includedWords = (AppState.summaryData && AppState.summaryData.includedWordsSummary)
            ? AppState.summaryData.includedWordsSummary
            : null;
        if (!includedWords && typeof OpinionSummarizer !== 'undefined' && OpinionSummarizer.buildIncludedWordsSummary) {
            includedWords = OpinionSummarizer.buildIncludedWordsSummary(
                AppState.filterResult,
                AppState.targetKeyword,
                AppState.resolvedTargetWord,
                AppState.relatedWords,
                AppState.subcorpusStats,
                AppState.matchMode,
                AppState.extractUnit
            );
        }

        // 11. 意見タイプ別代表意見（困りごと・要望・肯定 各3選）
        let repOpinionsByType = (AppState.summaryData && AppState.summaryData.repOpinionsByType)
            ? AppState.summaryData.repOpinionsByType
            : null;
        if (!repOpinionsByType && typeof OpinionSummarizer !== 'undefined' && OpinionSummarizer.extractRepresentativeOpinionsByType) {
            const mDocs = (AppState.filterResult && AppState.filterResult.matchedDocs) ? AppState.filterResult.matchedDocs : [];
            repOpinionsByType = OpinionSummarizer.extractRepresentativeOpinionsByType(mDocs, AppState.subcorpusStats, 3);
        }

        // 抽出条件ラベル
        const matchMode = AppState.matchMode || 'or';
        const extractUnit = AppState.extractUnit || 'doc';
        const matchModeLabel = matchMode === 'and' ? 'AND条件 (キーワード必須＋関連語)' : 'OR条件 (キーワード または 関連語)';
        const extractUnitLabel = extractUnit === 'sentence' ? '文単位抽出' : '回答全体抽出';

        const now = new Date();
        const dateStr = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

        return {
            dateStr,
            fileName: AppState.fileName || 'data.csv',
            targetKeyword: AppState.targetKeyword || '（全体分析）',
            resolvedWord: AppState.resolvedTargetWord || '',
            textCol: AppState.textCol || '（テキスト列）',
            attrCol: AppState.attrCol || '（属性列未設定）',
            matchMode,
            extractUnit,
            matchModeLabel,
            extractUnitLabel,
            totalRaw,
            totalFiltered,
            totalMatched,
            coverageRate,
            attrDist: attrDistFiltered.slice(0, 8),
            attrDistAll: attrDistAll.slice(0, 8),
            attrDistFiltered: attrDistFiltered.slice(0, 8),
            attrDistMatched: attrDistMatched.slice(0, 8),
            topWords,
            topCoocPairs,
            attrCrossTable: attrCrossTable.slice(0, 8),
            topicSummaries,
            clustersSummary,
            opinionTypeSummary,
            includedWords,
            repOpinionsByType
        };
    },

    /**
     * A4・全3ページのHTMLを生成する
     * （１）投入したデータ全体の概要
     * （２）指定したキーワードとその関連語と判断した語の概要
     * （３）分析対象の概要
     * （４）要約サマリー（集約概要と代表意見）
     * （５）ワードクラウド
     * （６）共起ネットワーク（特徴語重視、頻度重視）
     * （７）意見分布
     * （８）クロス集計
     */
    generateHtml(data, images) {
        // --- 1. 全体属性内訳ピル (投入データ全体) ---
        let attrSummaryAllHtml = '';
        if (data.attrDistAll && data.attrDistAll.length > 0) {
            attrSummaryAllHtml = `
                <div class="report-attr-pill-row" style="margin-top: 3px;">
                    <span class="report-attr-title">全体属性構成:</span>
                    ${data.attrDistAll.map(a => `
                        <span class="report-attr-tag"><b>${this.escape(a.category)}</b>: ${a.count.toLocaleString()}件 (${a.pct}%)</span>
                    `).join('')}
                </div>
            `;
        }

        // --- 2. 関連語判定概要ピル ---
        let relatedTagsHtml = '';
        if (data.includedWords) {
            const inc = data.includedWords;
            const targetTag = `<span class="report-word-pill target" title="注目キーワード">🎯 ${this.escape(inc.targetKeyword)}${inc.targetCount > 0 ? ` (${inc.targetCount}件)` : ''}</span>`;
            const resolvedTag = (inc.resolvedWord && inc.resolvedWord !== inc.targetKeyword)
                ? `<span class="report-word-pill resolved" title="中心代表語">🔹 ${this.escape(inc.resolvedWord)}${inc.resolvedCount > 0 ? ` (${inc.resolvedCount}件)` : ''}</span>`
                : '';
            const relatedTags = (inc.wordItems && inc.wordItems.length > 0)
                ? inc.wordItems.slice(0, 12).map(w => `<span class="report-word-pill ${w.type}">${this.escape(w.word)}${w.count > 0 ? ` (${w.count}件)` : ''}</span>`).join('')
                : '<span style="color:#94a3b8; font-size:9px;">（関連語指定なし / キーワード単体で抽出）</span>';
            const moreTag = (inc.wordItems && inc.wordItems.length > 12)
                ? `<span class="report-word-pill-more">他 ${inc.wordItems.length - 12} 語</span>`
                : '';

            relatedTagsHtml = `${targetTag} ${resolvedTag} ${relatedTags} ${moreTag}`;
        } else {
            relatedTagsHtml = `<span class="report-word-pill target">🎯 ${this.escape(data.targetKeyword)}</span>`;
        }

        // --- 3. キーワード該当意見の属性内訳ピル ---
        let attrSummaryMatchedHtml = '';
        if (data.attrDistMatched && data.attrDistMatched.length > 0) {
            attrSummaryMatchedHtml = `
                <div class="report-attr-pill-row" style="margin-top: 4px;">
                    <span class="report-attr-title">該当意見の属性内訳:</span>
                    ${data.attrDistMatched.map(a => `
                        <span class="report-attr-tag" style="background:#f1f5f9; border-color:#cbd5e1;"><b>${this.escape(a.category)}</b>: ${a.count.toLocaleString()}件 (${a.pct}%)</span>
                    `).join('')}
                </div>
            `;
        }

        // --- 4. 意見タイプ構成比バー ---
        let summaryTypeBarHtml = '';
        if (data.opinionTypeSummary) {
            const ots = data.opinionTypeSummary;
            summaryTypeBarHtml = `
                <div class="report-summary-type-row" style="margin-bottom: 4px;">
                    <div class="report-summary-type-header">
                        <span class="report-summary-sub-title">意見タイプ構成比（自動判定）:</span>
                        <span class="report-summary-sub-desc">全 ${data.totalMatched.toLocaleString()} 件の関連意見を発言意図・文脈別に分類</span>
                    </div>
                    <div class="report-type-bar-wrap">
                        <div class="report-type-bar issue" style="width: ${ots.issueRate}%;" title="困りごと・課題: ${ots.issueCount}件 (${ots.issueRate}%)"></div>
                        <div class="report-type-bar request" style="width: ${ots.requestRate}%;" title="要望・改善提案: ${ots.requestCount}件 (${ots.requestRate}%)"></div>
                        <div class="report-type-bar positive" style="width: ${ots.positiveRate}%;" title="肯定・満足: ${ots.positiveCount}件 (${ots.positiveRate}%)"></div>
                        <div class="report-type-bar neutral" style="width: ${ots.neutralRate}%;" title="その他・事実: ${ots.neutralCount}件 (${ots.neutralRate}%)"></div>
                    </div>
                    <div class="report-type-legend-row">
                        <span class="report-legend-tag issue">🔴 困りごと: <b>${ots.issueCount}件</b> (${ots.issueRate}%)</span>
                        <span class="report-legend-tag request">🔵 要望: <b>${ots.requestCount}件</b> (${ots.requestRate}%)</span>
                        <span class="report-legend-tag positive">🟢 肯定: <b>${ots.positiveCount}件</b> (${ots.positiveRate}%)</span>
                        <span class="report-legend-tag neutral">⚪ その他: <b>${ots.neutralCount}件</b> (${ots.neutralRate}%)</span>
                    </div>
                </div>
            `;
        }

        // --- 5. 意見タイプ別 代表的な生の声（3カラム） ---
        let typeRepHtml = '';
        if (data.repOpinionsByType) {
            const rbt = data.repOpinionsByType;
            const ots = data.opinionTypeSummary || { issueCount: 0, requestCount: 0, positiveCount: 0 };
            
            const cols = [
                {
                    type: 'issue',
                    label: '困りごと・課題',
                    icon: '🔴',
                    color: '#e11d48',
                    list: rbt.issue || [],
                    total: ots.issueCount || 0
                },
                {
                    type: 'request',
                    label: '要望・改善提案',
                    icon: '🔵',
                    color: '#0284c7',
                    list: rbt.request || [],
                    total: ots.requestCount || 0
                },
                {
                    type: 'positive',
                    label: '肯定・満足',
                    icon: '🟢',
                    color: '#10b981',
                    list: rbt.positive || [],
                    total: ots.positiveCount || 0
                }
            ];

            const colsHtml = cols.map(c => {
                let itemsHtml = '';
                if (c.list.length === 0) {
                    itemsHtml = `<div class="report-type-rep-empty">該当意見なし</div>`;
                } else {
                    itemsHtml = c.list.map(rep => {
                        let text = rep.doc.text ? rep.doc.text.trim() : '';
                        if (text.length > 70) text = text.substring(0, 70) + '…';
                        const attrText = rep.doc.attribute ? `<span class="report-type-rep-attr">[${this.escape(rep.doc.attribute)}]</span>` : '';
                        const scoreBadge = rep.doc.relevanceScore ? `<span class="report-type-rep-score">適合度 ${rep.doc.relevanceScore}%</span>` : '';
                        return `
                            <div class="report-type-rep-item">
                                <div class="report-type-rep-meta">
                                    <span class="report-type-rep-rank ${c.type}">#${rep.rank}</span>
                                    ${attrText}
                                    ${scoreBadge}
                                </div>
                                <div class="report-type-rep-quote">「${this.escape(text)}」</div>
                            </div>
                        `;
                    }).join('');
                }

                return `
                    <div class="report-type-rep-col ${c.type}">
                        <div class="report-type-rep-head" style="border-left: 3px solid ${c.color};">
                            <span class="report-type-rep-title">${c.icon} ${c.label}</span>
                            <span class="report-type-rep-count">${c.list.length}選 / 全${c.total}件</span>
                        </div>
                        <div class="report-type-rep-body">
                            ${itemsHtml}
                        </div>
                    </div>
                `;
            }).join('');

            // トピックインライン行
            let topicsInlineHtml = '';
            if (data.topicSummaries && data.topicSummaries.length > 0) {
                topicsInlineHtml = `
                    <div class="report-topic-inline-row" style="margin-top: 5px;">
                        <span class="report-topic-inline-lbl">🏷️ 主要論点トピック:</span>
                        ${data.topicSummaries.slice(0, 3).map(t => `
                            <span class="report-topic-inline-tag"><b>${this.escape(t.name.replace(/^論点 \d+:\s*/, ''))}</b> (${t.docCount}件)</span>
                        `).join('')}
                    </div>
                `;
            }

            typeRepHtml = `
                <div class="report-type-rep-grid" style="height: 100%;">
                    ${colsHtml}
                </div>
                ${topicsInlineHtml}
            `;
        }

        // --- 6. 頻出単語テーブル行 ---
        const topWordsRows = data.topWords.map(w => `
            <tr>
                <td style="text-align: center; font-weight: 700; color: #475569;">${w.rank}</td>
                <td style="font-weight: 600; color: #1e293b;">${this.escape(w.word)}</td>
                <td style="text-align: right; color: #334155;">${w.count.toLocaleString()} 件</td>
                <td style="text-align: right; color: #2563eb; font-weight: 600;">${w.rate}%</td>
            </tr>
        `).join('');

        // --- 7. 共起ペアテーブル行 ---
        const coocRows = data.topCoocPairs.length > 0 ? data.topCoocPairs.map(cp => `
            <tr>
                <td style="text-align: center; font-weight: 700; color: #475569;">${cp.rank}</td>
                <td style="font-weight: 600; color: #1e293b;">${this.escape(cp.pair)}</td>
                <td style="text-align: right; color: #0284c7; font-weight: 600;">${cp.count.toLocaleString()} 回</td>
            </tr>
        `).join('') : `<tr><td colspan="3" style="text-align:center; color:#94a3b8; padding: 12px;">共起データがありません</td></tr>`;

        // --- 8. 結びつきネットワーク（特徴語重視 ＆ 頻度重視）セクションHTML ---
        let networkSectionHtml = '';
        const hasAttrNetwork = (images.networkImgDistinct || images.networkImgFreq) && data.attrCol && data.attrCol !== '（属性列未設定）';

        if (hasAttrNetwork) {
            networkSectionHtml = `
                <div class="report-dual-grid">
                    <!-- 左: 特徴語重視 -->
                    <div class="report-card">
                        <div class="report-card-title">
                            <span>🎯 6-A. 属性別 結びつき（特徴度重視・特有語）</span>
                        </div>
                        <div class="report-chart-box" style="height: 60mm;">
                            ${images.networkImgDistinct ? `<img src="${images.networkImgDistinct}" class="report-chart-img" alt="属性ネットワーク(特徴度重視)" />` : `<div class="report-no-chart">画像準備中</div>`}
                        </div>
                        <div class="report-hint-box" style="margin-top: 4px;">
                            💡 <b>特有語の発見:</b> 他の属性と比べて突出して使われた単語を結びつけ、セグメント特有の悩みや独自関心をあぶり出します。
                        </div>
                    </div>

                    <!-- 右: 頻度重視 -->
                    <div class="report-card">
                        <div class="report-card-title">
                            <span>📊 6-B. 属性別 結びつき（頻度重視・高頻度語）</span>
                        </div>
                        <div class="report-chart-box" style="height: 60mm;">
                            ${images.networkImgFreq ? `<img src="${images.networkImgFreq}" class="report-chart-img" alt="属性ネットワーク(頻度重視)" />` : `<div class="report-no-chart">画像準備中</div>`}
                        </div>
                        <div class="report-hint-box" style="margin-top: 4px;">
                            💡 <b>共通語・ボリュームの把握:</b> 各属性で出現回数の多い単語を結びつけ、全体に共通する基本ニーズや関心規模を把握します。
                        </div>
                    </div>
                </div>
            `;
        } else {
            // 属性列未指定時のフォールバック: 全体単語共起ネットワーク ＋ 共起ペア表
            const netImg = images.networkImgWord || images.networkImg;
            networkSectionHtml = `
                <div class="report-dual-grid">
                    <div class="report-card">
                        <div class="report-card-title">
                            <span>🌐 6. 単語共起ネットワーク（全体の話題構造）</span>
                        </div>
                        <div class="report-chart-box" style="height: 60mm;">
                            ${netImg ? `<img src="${netImg}" class="report-chart-img" alt="共起ネットワーク" />` : `<div class="report-no-chart">画像がありません</div>`}
                        </div>
                    </div>
                    <div class="report-card">
                        <div class="report-card-title">強く共起している単語ペア Top 6</div>
                        <table class="report-table">
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
                        <div class="report-hint-box" style="margin-top: 6px;">
                            💡 色のまとまりは同一文脈で語られる話題クラスタを表し、線の太さは共起の強さを示します。
                        </div>
                    </div>
                </div>
            `;
        }

        // --- 9. UMAPクラスタ傾向HTML ---
        let clustersHtml = '';
        if (data.clustersSummary && data.clustersSummary.length > 0) {
            clustersHtml = `
                <table class="report-table">
                    <thead>
                        <tr>
                            <th style="width: 32px; text-align: center;">#</th>
                            <th style="width: 78px;">クラスタ名</th>
                            <th style="width: 48px; text-align: right;">件数</th>
                            <th>主要な代表語彙・話題傾向</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.clustersSummary.map(c => `
                            <tr>
                                <td style="text-align: center; font-weight: 700; color: #475569;">${c.id}</td>
                                <td style="font-weight: 600; color: #1e293b;">${this.escape(c.label)}</td>
                                <td style="text-align: right; color: #2563eb; font-weight: 600;">${c.size}件</td>
                                <td style="color: #475569; font-size: 9.5px;">${this.escape(c.topKw)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        } else {
            clustersHtml = `<div class="report-hint-box" style="padding: 10px; text-align: center;">クラスタリング可能な十分な意見数がありません</div>`;
        }

        // --- 10. 属性別クロス集計テーブル行 ---
        const attrCrossRows = data.attrCrossTable.length > 0 ? data.attrCrossTable.map(ac => `
            <tr>
                <td style="font-weight: 600; color: #1e293b;">${this.escape(ac.category)}</td>
                <td style="text-align: right; color: #64748b;">${ac.popCount.toLocaleString()}</td>
                <td style="text-align: right; color: #334155; font-weight: 600;">${ac.matchedCount.toLocaleString()}</td>
                <td style="text-align: right; color: #2563eb; font-weight: 700; background: #f0f7ff;">${ac.rate}%</td>
                <td style="text-align: right; color: #475569;">${ac.share}%</td>
            </tr>
        `).join('') : `<tr><td colspan="5" style="text-align:center; color:#94a3b8; padding: 12px;">属性列が未選択です</td></tr>`;


        // =========================================================================
        // 📄 ページ1: 分析前提 ＆ 要約サマリー (1/3)
        // =========================================================================
        const page1 = `
            <div class="report-page" id="reportPage1">
                <!-- ページ1 ヘッダー -->
                <div class="report-header">
                    <div class="report-header-main">
                        <div class="report-title-badge">FOCUS EXPLORER REPORT (1/3)</div>
                        <h2 class="report-title">分析前提 ＆ キーワード要約サマリーレポート</h2>
                    </div>
                    <div class="report-header-meta">
                        <div><b>出力日時:</b> ${data.dateStr}</div>
                        <div><b>対象ファイル:</b> ${this.escape(data.fileName)}</div>
                    </div>
                </div>

                <!-- (1) 投入したデータ全体の概要 -->
                <div class="report-section">
                    <div class="report-sec-title">📁 1. 投入したデータ全体の概要</div>
                    <div class="report-condition-bar">
                        <div class="report-condition-item">
                            <span class="report-condition-lbl">対象ファイル:</span>
                            <span class="report-condition-val">${this.escape(data.fileName)}</span>
                        </div>
                        <div class="report-condition-item">
                            <span class="report-condition-lbl">全体回答数:</span>
                            <span class="report-condition-val" style="color: #2563eb;">${data.totalRaw.toLocaleString()} 件</span>
                        </div>
                        <div class="report-condition-item">
                            <span class="report-condition-lbl">分析列:</span>
                            <span class="report-condition-val">📄 ${this.escape(data.textCol)}</span>
                            ${data.attrCol && data.attrCol !== '（属性列未設定）' ? `<span style="color: #64748b; font-size: 9.5px; margin-left: 4px;">/ 👥 属性列: <b>${this.escape(data.attrCol)}</b></span>` : ''}
                        </div>
                    </div>
                    ${attrSummaryAllHtml}
                </div>

                <!-- (2) 指定したキーワードとその関連語と判断した語の概要 -->
                <div class="report-section" style="margin-top: 5px;">
                    <div class="report-sec-title">🎯 2. 指定キーワード ＆ 判定された関連語の概要</div>
                    <div class="report-kw-detail-box">
                        <div class="report-kw-head-row">
                            <div class="report-kw-badge-group">
                                <span class="report-condition-lbl">指定キーワード:</span>
                                <span class="report-condition-val-accent">🎯 ${this.escape(data.targetKeyword)}</span>
                                ${data.resolvedWord && data.resolvedWord !== data.targetKeyword ? `<span style="font-size: 9.5px; color: #64748b; margin-left: 4px;">(代表形: <b>${this.escape(data.resolvedWord)}</b>)</span>` : ''}
                            </div>
                            <div class="report-kw-rule-group">
                                <span class="report-condition-lbl">抽出条件:</span>
                                <span class="report-condition-val">${data.matchMode === 'and' ? 'AND条件 (キーワード必須＋関連語)' : 'OR条件 (キーワード または 関連語)'} / ${data.extractUnit === 'sentence' ? '文単位抽出' : '回答全体抽出'}</span>
                            </div>
                        </div>
                        <div class="report-kw-desc-row">
                            <span class="report-kw-desc-lbl">💡 関連語の判定基準:</span>
                            <span class="report-kw-desc-text">注目キーワードとの共起頻度および統計的関連度（Jaccard係数）に基づき、同じ文脈で密接に語られている語を自動選定</span>
                        </div>
                        <div class="report-included-words-row" style="margin-top: 3px; padding-top: 3px; border-top: 1px dashed #cbd5e1;">
                            <span class="report-included-title">採用された関連語一覧:</span>
                            <div class="report-included-tags">
                                ${relatedTagsHtml}
                            </div>
                        </div>
                    </div>
                </div>

                <!-- (3) 分析対象の概要 -->
                <div class="report-section" style="margin-top: 5px;">
                    <div class="report-sec-title">📌 3. 分析対象（該当意見群）の概要</div>
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
                    ${attrSummaryMatchedHtml}
                </div>

                <!-- (4) 要約サマリー（集約概要と代表意見） -->
                <div class="report-section" style="margin-top: 5px; flex: 1; display: flex; flex-direction: column;">
                    <div class="report-sec-title">💡 4. 要約サマリー（集約概要 ＆ 代表意見） [対象: 🎯「${this.escape(data.targetKeyword)}」]</div>
                    ${summaryTypeBarHtml}
                    <div style="flex: 1; margin-top: 4px;">
                        ${typeRepHtml}
                    </div>
                </div>

                <!-- ページ1 フッター -->
                <div class="report-footer">
                    <span>キーワード連想＆意見深掘りツール (Focus Explorer)</span>
                    <span>1 / 3</span>
                </div>
            </div>
        `;


        // =========================================================================
        // 📄 ページ2: テキスト構造分析（ワードクラウド ＆ 結びつきネットワーク） (2/3)
        // =========================================================================
        const page2 = `
            <div class="report-page" id="reportPage2">
                <!-- ページ2 ヘッダー -->
                <div class="report-header">
                    <div class="report-header-main">
                        <div class="report-title-badge">FOCUS EXPLORER REPORT (2/3)</div>
                        <h2 class="report-title">テキスト構造分析（ワードクラウド ＆ 結びつきネットワーク）</h2>
                    </div>
                    <div class="report-header-meta">
                        <div><b>対象キーワード:</b> 🎯「${this.escape(data.targetKeyword)}」</div>
                        <div><b>ファイル:</b> ${this.escape(data.fileName)}</div>
                    </div>
                </div>

                <!-- (5) ワードクラウド -->
                <div class="report-section" style="margin-bottom: 6px;">
                    <div class="report-sec-title">☁️ 5. 頻出重要単語（ワードクラウド ＆ 出現頻度ランキング） [対象: 🎯「${this.escape(data.targetKeyword)}」]</div>
                    <div class="report-dual-grid">
                        <!-- 左: ワードクラウド -->
                        <div class="report-card">
                            <div class="report-card-title">頻出重要単語（ワードクラウド）</div>
                            <div class="report-chart-box" style="height: 48mm;">
                                ${images.cloudImg ? `<img src="${images.cloudImg}" class="report-chart-img" alt="ワードクラウド" />` : `<div class="report-no-chart">画像がありません</div>`}
                            </div>
                        </div>

                        <!-- 右: 頻出単語表 -->
                        <div class="report-card">
                            <div class="report-card-title">頻出単語 Top 10（出現回数・出現率）</div>
                            <table class="report-table">
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
                    </div>
                </div>

                <!-- (6) 共起ネットワーク（特徴語重視、頻度重視） -->
                <div class="report-section" style="flex: 1; display: flex; flex-direction: column;">
                    <div class="report-sec-title">🕸️ 6. 結びつき構造ネットワーク（特徴語重視 ＆ 頻度重視） [対象: 🎯「${this.escape(data.targetKeyword)}」${data.attrCol && data.attrCol !== '（属性列未設定）' ? ` / 整理属性: 👥「${this.escape(data.attrCol)}」` : ''}]</div>
                    ${networkSectionHtml}
                </div>

                <!-- ページ2 フッター -->
                <div class="report-footer">
                    <span>キーワード連想＆意見深掘りツール (Focus Explorer)</span>
                    <span>2 / 3</span>
                </div>
            </div>
        `;


        // =========================================================================
        // 📄 ページ3: 意見分布構造（UMAP） ＆ 属性クロス集計・考察 (3/3)
        // =========================================================================
        const page3 = `
            <div class="report-page" id="reportPage3">
                <!-- ページ3 ヘッダー -->
                <div class="report-header">
                    <div class="report-header-main">
                        <div class="report-title-badge">FOCUS EXPLORER REPORT (3/3)</div>
                        <h2 class="report-title">意見分布構造（UMAP） ＆ 属性クロス集計・考察</h2>
                    </div>
                    <div class="report-header-meta">
                        <div><b>対象キーワード:</b> 🎯「${this.escape(data.targetKeyword)}」</div>
                        <div><b>整理属性:</b> 👥「${this.escape(data.attrCol)}」</div>
                    </div>
                </div>

                <!-- (7) 意見分布 -->
                <div class="report-section" style="margin-bottom: 6px;">
                    <div class="report-sec-title">🌌 7. 意見分布構造（UMAP散布図 ＆ 話題クラスタ） [対象: 🎯「${this.escape(data.targetKeyword)}」]</div>
                    <div class="report-dual-grid">
                        <!-- 左: UMAP散布図 -->
                        <div class="report-card">
                            <div class="report-card-title">発言の意味的類似度マップ（UMAP散布図）</div>
                            <div class="report-chart-box" style="height: 50mm;">
                                ${images.umapImg ? `<img src="${images.umapImg}" class="report-chart-img" alt="UMAP散布図" />` : `<div class="report-no-chart">画像がありません</div>`}
                            </div>
                            <div class="report-hint-box" style="margin-top: 4px;">
                                💡 各プロットは1件の発言を表し、距離が近い発言ほど意味・文脈が類似しています。
                            </div>
                        </div>

                        <!-- 右: クラスタ傾向表 -->
                        <div class="report-card">
                            <div class="report-card-title">主要な意見クラスタ傾向</div>
                            ${clustersHtml}
                        </div>
                    </div>
                </div>

                <!-- (8) クロス集計 -->
                <div class="report-section" style="margin-bottom: 6px;">
                    <div class="report-sec-title">📈 8. 属性別クロス集計 [整理属性: 👥「${this.escape(data.attrCol)}」 / 対象: 🎯「${this.escape(data.targetKeyword)}」]</div>
                    <div class="report-dual-grid">
                        <!-- 左: グラフ -->
                        <div class="report-card">
                            <div class="report-card-title">属性「${this.escape(data.attrCol)}」別の言及傾向グラフ</div>
                            <div class="report-chart-box" style="height: 38mm;">
                                ${images.attrImg ? `<img src="${images.attrImg}" class="report-chart-img" alt="属性グラフ" />` : `<div class="report-no-chart">${data.attrCol !== '（属性列未設定）' ? 'グラフ準備中' : '属性列が未選択です'}</div>`}
                            </div>
                        </div>

                        <!-- 右: クロス集計表 -->
                        <div class="report-card">
                            <div class="report-card-title">属性クロス集計詳細表</div>
                            <table class="report-table">
                                <thead>
                                    <tr>
                                        <th>属性区分（${this.escape(data.attrCol)}）</th>
                                        <th style="width: 44px; text-align: right;">母数</th>
                                        <th style="width: 44px; text-align: right;">言及数</th>
                                        <th style="width: 52px; text-align: right;">言及率%</th>
                                        <th style="width: 48px; text-align: right;">構成比%</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${attrCrossRows}
                                </tbody>
                            </table>
                            <div class="report-hint-box" style="margin-top: 3px;">
                                ※ 言及率は各属性内での出現割合、構成比は意見全体でのシェアです。
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 分析所見・考察メモ欄 -->
                <div class="report-section" style="flex: 1; display: flex; flex-direction: column;">
                    <div class="report-sec-title">📝 分析所見・考察メモ（報告用）</div>
                    <div class="report-memo-wrapper" style="flex: 1; min-height: 24mm;">
                        <!-- 画面プレビュー時は入力可能 -->
                        <textarea id="reportInputMemo" class="report-memo-input no-print" style="height: 100%; min-height: 22mm;" placeholder="ここに分析結果の要約や所見、考察、ネクストアクションなどを自由に入力できます（印刷時にそのまま反映されます）。">${this.escape(this.memoText)}</textarea>
                        <!-- 印刷時は静的テキストとして印字 -->
                        <div id="reportPrintMemo" class="report-memo-print print-only">${this.escape(this.memoText || '（特記事項なし）')}</div>
                    </div>
                </div>

                <!-- ページ3 フッター -->
                <div class="report-footer">
                    <span>キーワード連想＆意見深掘りツール (Focus Explorer)</span>
                    <span>3 / 3</span>
                </div>
            </div>
        `;

        return page1 + page2 + page3;
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
