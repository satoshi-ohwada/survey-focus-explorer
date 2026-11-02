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

        // 4. 頻出単語 Top 15
        const wordList = (AppState.subcorpusStats && AppState.subcorpusStats.wordList) ? AppState.subcorpusStats.wordList : [];
        const topWords = wordList.slice(0, 15).map((w, idx) => {
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

        // 8. UMAPクラスタ傾向（多段フォールバック付きで確実に取得）
        const clustersSummary = [];
        // 優先1: UmapVisualizer.clusters から取得
        if (typeof UmapVisualizer !== 'undefined' && UmapVisualizer.clusters && UmapVisualizer.clusters.length > 0) {
            UmapVisualizer.clusters.slice(0, 5).forEach((c, idx) => {
                const topKw = Array.isArray(c.topWords) ? c.topWords.slice(0, 4).join(', ') : (c.topKw || '');
                clustersSummary.push({
                    id: idx + 1,
                    label: c.label || `グループ ${idx + 1}`,
                    size: c.size || 0,
                    topKw: topKw || '（代表語彙なし）'
                });
            });
        }
        // 優先2: UmapVisualizer.points から動的にクラスタ集計（HDBSCAN/K-Means結果）
        if (clustersSummary.length === 0 && typeof UmapVisualizer !== 'undefined' && UmapVisualizer.points && UmapVisualizer.points.length > 0) {
            const clusterMap = new Map();
            UmapVisualizer.points.forEach(p => {
                const cid = (p.cluster != null && p.cluster >= 0) ? p.cluster : 0;
                if (!clusterMap.has(cid)) clusterMap.set(cid, []);
                clusterMap.get(cid).push(p);
            });
            clusterMap.forEach((pts, cid) => {
                const wordFreq = {};
                pts.forEach(p => {
                    const tokens = (p.rawDoc && p.rawDoc.tokens) ? p.rawDoc.tokens : (p.tokens || []);
                    tokens.forEach(t => {
                        if (t && t.length >= 2) wordFreq[t] = (wordFreq[t] || 0) + 1;
                    });
                });
                const topWords = Object.entries(wordFreq).sort((a, b) => b[1] - a[1]).slice(0, 4).map(e => e[0]);
                const topKw = topWords.length > 0 ? topWords.join(', ') : (pts[0] && pts[0].text ? pts[0].text : '（代表語彙なし）');
                const label = topWords.length > 0 ? `トピック ${cid + 1}: ${topWords.slice(0, 2).join('・')}` : `グループ ${cid + 1}`;
                clustersSummary.push({
                    id: cid + 1,
                    label,
                    size: pts.length,
                    topKw
                });
            });
            clustersSummary.sort((a, b) => b.size - a.size);
        }
        // 優先3: AppState.summaryData.topicSummaries から論点クラスタを活用
        if (clustersSummary.length === 0 && AppState.summaryData && AppState.summaryData.topicSummaries && AppState.summaryData.topicSummaries.length > 0) {
            AppState.summaryData.topicSummaries.slice(0, 4).forEach((t, idx) => {
                clustersSummary.push({
                    id: idx + 1,
                    label: t.name ? t.name.replace(/^論点 \d+:\s*/, '') : `トピック ${idx + 1}`,
                    size: t.docCount || 0,
                    topKw: (t.keywords || []).slice(0, 4).join(', ') || '（代表語彙なし）'
                });
            });
        }
        // 優先4: 関連意見全体から単一グループとして集計（極端な小データでも必ず表示）
        if (clustersSummary.length === 0 && matchedDocs.length > 0) {
            const topKw = topWords.slice(0, 4).map(w => w.word).join(', ');
            clustersSummary.push({
                id: 1,
                label: `全体グループ (共通関心)`,
                size: matchedDocs.length,
                topKw: topKw || '（代表語彙なし）'
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

        // 11. 意見タイプ別代表意見（困りごと・要望・肯定 各5選）
        let repOpinionsByType = null;
        if (typeof OpinionSummarizer !== 'undefined' && OpinionSummarizer.extractRepresentativeOpinionsByType) {
            const mDocs = (AppState.filterResult && AppState.filterResult.matchedDocs) ? AppState.filterResult.matchedDocs : [];
            repOpinionsByType = OpinionSummarizer.extractRepresentativeOpinionsByType(mDocs, AppState.subcorpusStats, 5);
        }
        if (!repOpinionsByType && AppState.summaryData && AppState.summaryData.repOpinionsByType) {
            repOpinionsByType = AppState.summaryData.repOpinionsByType;
        }

        // 12. 属性項目ごとの代表的な意見（生の声・各属性2〜3例）
        const attrRepresentativeOpinions = [];
        if (AppState.attrCol && matchedDocs.length > 0) {
            const docsByAttr = {};
            matchedDocs.forEach(d => {
                const cat = d.attribute && d.attribute.trim() !== '' ? d.attribute.trim() : '（未回答・不明）';
                if (!docsByAttr[cat]) docsByAttr[cat] = [];
                docsByAttr[cat].push(d);
            });

            // 言及数の多い順または言及率の高い順の上位属性を最大6カテゴリ選出
            const sortedAttrs = (attrCrossTable.length > 0 ? attrCrossTable : attrDistFiltered).slice(0, 6);

            sortedAttrs.forEach(stat => {
                const cat = stat.category;
                const docs = docsByAttr[cat] || [];
                if (docs.length === 0) return;

                // 代表意見の選定（各属性2〜3例）
                let repDocs = [];
                if (typeof OpinionSummarizer !== 'undefined' && OpinionSummarizer.extractRepresentativeOpinions) {
                    const reps = OpinionSummarizer.extractRepresentativeOpinions(docs, AppState.subcorpusStats, 3);
                    if (reps && reps.length > 0) repDocs = reps.map(r => r.doc);
                }
                if (repDocs.length === 0) {
                    const sorted = [...docs].sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
                    repDocs = sorted.filter(d => (d.text || '').trim().length >= 8).slice(0, 3);
                    if (repDocs.length === 0 && docs.length > 0) repDocs = docs.slice(0, 3);
                }

                if (repDocs.length > 0) {
                    const bestDoc = repDocs[0];
                    let firstOpType = bestDoc.opinionType || '';
                    if (!firstOpType && typeof TextPreprocessor !== 'undefined' && TextPreprocessor.classifyOpinionType) {
                        firstOpType = TextPreprocessor.classifyOpinionType(bestDoc.text);
                    }
                    let firstText = bestDoc.text ? bestDoc.text.trim() : '';
                    if (firstText.length > 70) firstText = firstText.substring(0, 70) + '…';

                    const opinionsList = repDocs.map(d => {
                        let opType = d.opinionType || '';
                        if (!opType && typeof TextPreprocessor !== 'undefined' && TextPreprocessor.classifyOpinionType) {
                            opType = TextPreprocessor.classifyOpinionType(d.text);
                        }
                        let text = d.text ? d.text.trim() : '';
                        if (text.length > 60) text = text.substring(0, 60) + '…';
                        return {
                            text,
                            opinionType: opType,
                            relevanceScore: d.relevanceScore || null
                        };
                    });

                    attrRepresentativeOpinions.push({
                        category: cat,
                        matchedCount: stat.matchedCount || docs.length,
                        popCount: stat.popCount || docs.length,
                        rate: stat.rate || '0.0',
                        share: stat.share || '0.0',
                        opinionType: firstOpType,
                        relevanceScore: bestDoc.relevanceScore || null,
                        text: firstText,
                        opinions: opinionsList
                    });
                }
            });
        }

        // 13. 属性毎ではない全体状況データ（語彙規模・全体比特異語）
        let totalWordTokens = 0;
        const uniqueVocab = new Set();
        matchedDocs.forEach(d => {
            (d.tokens || []).forEach(t => {
                totalWordTokens++;
                uniqueVocab.add(t);
            });
        });
        const vocabCount = uniqueVocab.size;

        let oddsKeywords = [];
        if (AppState.summaryData && AppState.summaryData.oddsRatioKeywords && AppState.summaryData.oddsRatioKeywords.length > 0) {
            oddsKeywords = AppState.summaryData.oddsRatioKeywords.slice(0, 5);
        } else if (typeof OpinionSummarizer !== 'undefined' && OpinionSummarizer.computeOddsRatioKeywords) {
            oddsKeywords = OpinionSummarizer.computeOddsRatioKeywords(AppState.totalCorpusStats, AppState.subcorpusStats, 5);
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
            totalWordTokens,
            vocabCount,
            oddsKeywords,
            topWords,
            topCoocPairs,
            attrCrossTable: attrCrossTable.slice(0, 8),
            topicSummaries,
            clustersSummary,
            opinionTypeSummary,
            includedWords,
            repOpinionsByType,
            attrRepresentativeOpinions
        };
    },

    /**
     * A4・全3ページのHTMLを生成する
     * （１）アンケートの概要 ＆ 全体要約サマリー（Page 1: 項目1〜4）
     * （２）キーワードと関連語の使用状況・全体可視化集約（Page 2: 項目5〜6）
     * （３）属性情報とキーワード関連語の関係・属性別深掘り集約（Page 3: 項目7〜8）
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

        // --- 5. 意見タイプ別 代表的な生の声（3カラム・各最大5選） ---
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
                    list: (rbt.issue || []).slice(0, 5),
                    total: ots.issueCount || 0
                },
                {
                    type: 'request',
                    label: '要望・改善提案',
                    icon: '🔵',
                    color: '#0284c7',
                    list: (rbt.request || []).slice(0, 5),
                    total: ots.requestCount || 0
                },
                {
                    type: 'positive',
                    label: '肯定・満足',
                    icon: '🟢',
                    color: '#10b981',
                    list: (rbt.positive || []).slice(0, 5),
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
                        if (text.length > 55) text = text.substring(0, 55) + '…';
                        const attrText = rep.doc.attribute ? `<span class="report-type-rep-attr">[${this.escape(rep.doc.attribute)}]</span>` : '';
                        const scoreBadge = rep.doc.relevanceScore ? `<span class="report-type-rep-score">適合度 ${rep.doc.relevanceScore}%</span>` : '';
                        return `
                            <div class="report-type-rep-item" style="padding: 2px 4.5px; margin-bottom: 2px;">
                                <div class="report-type-rep-meta">
                                    <span class="report-type-rep-rank ${c.type}">#${rep.rank}</span>
                                    ${attrText}
                                    ${scoreBadge}
                                </div>
                                <div class="report-type-rep-quote" style="font-size: 7.2px; line-height: 1.3;">「${this.escape(text)}」</div>
                            </div>
                        `;
                    }).join('');
                }

                return `
                    <div class="report-type-rep-col ${c.type}">
                        <div class="report-type-rep-head" style="border-left: 3px solid ${c.color}; margin-bottom: 2px;">
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

        // --- 6. 頻出単語テーブル行 (Top 15: 全体状況) ---
        const topWordsRows = data.topWords.slice(0, 15).map(w => `
            <tr>
                <td style="text-align: center; font-weight: 700; color: #475569; padding: 1.5px 3px;">${w.rank}</td>
                <td style="font-weight: 600; color: #1e293b; padding: 1.5px 3px;">${this.escape(w.word)}</td>
                <td style="text-align: right; color: #334155; padding: 1.5px 3px;">${w.count.toLocaleString()} 件</td>
                <td style="text-align: right; color: #2563eb; font-weight: 600; padding: 1.5px 3px;">${w.rate}%</td>
            </tr>
        `).join('');

        // --- 6-2. 全体比特異キーワード（出現率オッズ比上位）HTML ---
        let oddsKeywordsHtml = '';
        if (data.oddsKeywords && data.oddsKeywords.length > 0) {
            oddsKeywordsHtml = `
                <div class="report-odds-box">
                    <div class="report-odds-head">
                        <span class="report-odds-title">🌟 全体データ比の特異キーワード (全体状況):</span>
                        <span class="report-odds-sub">全体より突出して多く使われた語</span>
                    </div>
                    <div class="report-odds-tags">
                        ${data.oddsKeywords.map(k => `
                            <span class="report-odds-tag"><b>#${this.escape(k.word)}</b> (${k.oddsRatio}倍)</span>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        // --- 7. 共起ペアテーブル行 ---
        const coocRows = data.topCoocPairs.length > 0 ? data.topCoocPairs.map(cp => `
            <tr>
                <td style="text-align: center; font-weight: 700; color: #475569;">${cp.rank}</td>
                <td style="font-weight: 600; color: #1e293b;">${this.escape(cp.pair)}</td>
                <td style="text-align: right; color: #0284c7; font-weight: 600;">${cp.count.toLocaleString()} 回</td>
            </tr>
        `).join('') : `<tr><td colspan="3" style="text-align:center; color:#94a3b8; padding: 12px;">共起データがありません</td></tr>`;

        // --- 8. 【属性ごとの状況】結びつきネットワーク（特徴語重視 ＆ 頻度重視）セクションHTML ---
        let attrNetworkSectionHtml = '';
        const hasAttrNetwork = (images.networkImgDistinct || images.networkImgFreq) && data.attrCol && data.attrCol !== '（属性列未設定）';

        if (hasAttrNetwork) {
            attrNetworkSectionHtml = `
                <div class="report-dual-grid">
                    <!-- 左: 特徴語重視 -->
                    <div class="report-card">
                        <div class="report-card-title">
                            <span>🎯 7-A. 属性別 結びつき（特徴度重視・特有語）</span>
                        </div>
                        <div class="report-chart-box" style="height: 44mm;">
                            ${images.networkImgDistinct ? `<img src="${images.networkImgDistinct}" class="report-chart-img" alt="属性ネットワーク(特徴度重視)" />` : `<div class="report-no-chart">画像準備中</div>`}
                        </div>
                        <div class="report-hint-box" style="margin-top: 3px;">
                            💡 <b>特有語の発見:</b> 他の属性と比べて突出して使われた単語を結びつけ、セグメント特有の悩みや独自関心をあぶり出します。
                        </div>
                    </div>

                    <!-- 右: 頻度重視 -->
                    <div class="report-card">
                        <div class="report-card-title">
                            <span>📊 7-B. 属性別 結びつき（頻度重視・高頻度語）</span>
                        </div>
                        <div class="report-chart-box" style="height: 44mm;">
                            ${images.networkImgFreq ? `<img src="${images.networkImgFreq}" class="report-chart-img" alt="属性ネットワーク(頻度重視)" />` : `<div class="report-no-chart">画像準備中</div>`}
                        </div>
                        <div class="report-hint-box" style="margin-top: 3px;">
                            💡 <b>共通語・ボリュームの把握:</b> 各属性で出現回数の多い単語を結びつけ、全体に共通する基本ニーズや関心規模を把握します。
                        </div>
                    </div>
                </div>
            `;
        } else {
            // 属性列未指定時の案内
            attrNetworkSectionHtml = `
                <div class="report-hint-box" style="padding: 16px; text-align: center; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 4px;">
                    <div style="font-weight: 700; color: #475569; font-size: 11px; margin-bottom: 4px;">👥 属性列が未選択です</div>
                    <div style="color: #64748b; font-size: 9.5px;">上部の設定パネルで「年代」や「性別」などの属性列を選択すると、属性ごとの特徴度重視ネットワーク（特有語）と頻度重視ネットワーク（高頻度語）がここに自動生成されます。</div>
                </div>
            `;
        }

        // --- 9. UMAPクラスタ傾向HTML ---
        let clustersHtml = '';
        if (data.clustersSummary && data.clustersSummary.length > 0) {
            clustersHtml = `
                <table class="report-table" style="margin-top: 3px;">
                    <thead>
                        <tr>
                            <th style="width: 28px; text-align: center;">#</th>
                            <th style="width: 76px;">クラスタ名</th>
                            <th style="width: 44px; text-align: right;">件数</th>
                            <th>代表語彙・話題傾向</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.clustersSummary.map(c => `
                            <tr>
                                <td style="text-align: center; font-weight: 700; color: #475569;">${c.id}</td>
                                <td style="font-weight: 600; color: #1e293b;">${this.escape(c.label)}</td>
                                <td style="text-align: right; color: #2563eb; font-weight: 600;">${c.size}件</td>
                                <td style="color: #475569; font-size: 8.5px;">${this.escape(c.topKw)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        } else {
            clustersHtml = `<div class="report-hint-box" style="padding: 6px; text-align: center; margin-top: 3px;">クラスタリング可能な十分な意見数がありません</div>`;
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

        // --- 11. 属性項目ごとの代表的な意見（生の声・各属性2〜3例）HTML ---
        let attrRepOpinionsHtml = '';
        if (data.attrRepresentativeOpinions && data.attrRepresentativeOpinions.length > 0) {
            const cardsHtml = data.attrRepresentativeOpinions.map(item => {
                const opinionsList = (item.opinions && item.opinions.length > 0)
                    ? item.opinions
                    : [{ text: item.text, opinionType: item.opinionType, relevanceScore: item.relevanceScore }];

                const quotesHtml = opinionsList.map(op => {
                    let typeBadge = '';
                    if (op.opinionType === 'issue') {
                        typeBadge = '<span class="report-type-badge issue">🔴 困りごと</span>';
                    } else if (op.opinionType === 'request') {
                        typeBadge = '<span class="report-type-badge request">🔵 要望</span>';
                    } else if (op.opinionType === 'positive') {
                        typeBadge = '<span class="report-type-badge positive">🟢 肯定</span>';
                    } else {
                        typeBadge = '<span class="report-type-badge neutral">⚪ その他</span>';
                    }

                    const scoreBadge = op.relevanceScore
                        ? `<span class="report-type-rep-score">適合度 ${op.relevanceScore}%</span>`
                        : '';

                    return `
                        <div class="report-attr-rep-quote-item">
                            ${typeBadge}
                            <span class="report-quote-text">「${this.escape(op.text)}」</span>
                            ${scoreBadge}
                        </div>
                    `;
                }).join('');

                return `
                    <div class="report-attr-rep-card">
                        <div class="report-attr-rep-head">
                            <div class="report-attr-rep-title-group">
                                <span class="report-attr-rep-badge">👥 ${this.escape(item.category)}</span>
                                <span class="report-attr-rep-stats">言及 <b>${item.matchedCount}件</b> (言及率 <b>${item.rate}%</b> / 構成比 ${item.share}%)</span>
                            </div>
                            <span class="report-attr-rep-count-badge">代表意見 ${opinionsList.length}選</span>
                        </div>
                        <div class="report-attr-rep-quotes">
                            ${quotesHtml}
                        </div>
                    </div>
                `;
            }).join('');

            attrRepOpinionsHtml = `
                <div class="report-attr-rep-grid">
                    ${cardsHtml}
                </div>
            `;
        } else {
            attrRepOpinionsHtml = `
                <div class="report-hint-box" style="padding: 10px; text-align: center;">
                    ${data.attrCol && data.attrCol !== '（属性列未設定）'
                        ? '属性ごとの代表意見を抽出するのに十分な意見数がありません'
                        : '属性列が未選択です。上部の設定パネルで年代や地域などの属性列を選択すると、属性ごとの代表意見がここに自動表示されます'}
                </div>
            `;
        }


        // =========================================================================
        // 📄 ページ1: 分析前提 ＆ キーワード要約サマリー (1/3)
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
                    
                    <!-- 意見タイプ自動3分類基準の解説ボックス（常時表示） -->
                    <div class="report-type-criteria-box">
                        <div class="report-type-criteria-head">
                            <span class="report-type-criteria-title">💡 意見タイプの3分類基準:</span>
                            <span class="report-type-criteria-desc">文章全体の文脈構造および感情極性語彙パターンに基づき、発言者の意図を以下の3つに自動判定・分類しています。</span>
                        </div>
                        <div class="report-type-criteria-tags">
                            <span class="report-criteria-item issue">🔴 <b>困りごと・課題</b>: 不満・使いづらさ・問題点・不具合の指摘など、改善が急務とされる課題発言</span>
                            <span class="report-criteria-item request">🔵 <b>要望・改善提案</b>: 機能追加やサービス拡充、「〜してほしい」「〜を希望」などの前向きなリクエスト</span>
                            <span class="report-criteria-item positive">🟢 <b>肯定・満足</b>: 満足感・感謝・「使いやすい」「親切」「助かった」などのポジティブな高評価</span>
                        </div>
                    </div>

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
        // 📄 ページ2: キーワードと関連語の使用状況（属性分解前の全体状況・可視化集約） (2/3)
        // =========================================================================
        const globalNetImg = images.networkImgWord || images.networkImg;
        const page2 = `
            <div class="report-page" id="reportPage2">
                <!-- ページ2 ヘッダー -->
                <div class="report-header">
                    <div class="report-header-main">
                        <div class="report-title-badge">FOCUS EXPLORER REPORT (2/3)</div>
                        <h2 class="report-title">キーワードと関連語の使用状況（全体話題構造 ＆ 意見分布）</h2>
                    </div>
                    <div class="report-header-meta">
                        <div><b>対象キーワード:</b> 🎯「${this.escape(data.targetKeyword)}」</div>
                        <div><b>全体回答数:</b> ${data.totalRaw.toLocaleString()} 件 / <b>該当:</b> ${data.totalMatched.toLocaleString()} 件</div>
                    </div>
                </div>

                <!-- (5) 【全体状況】語彙・共起構造（ワードクラウド ＆ 全体共起ネットワーク） -->
                <div class="report-section" style="margin-bottom: 5px;">
                    <div class="report-sec-title">
                        <span>🌐 5. 【全体状況】語彙・話題構造（ワードクラウド ＆ 全体共起ネットワーク） [属性毎ではない全体状況 / 対象: 🎯「${this.escape(data.targetKeyword)}」]</span>
                    </div>
                    
                    <!-- 全体状況サマリーバナー -->
                    <div class="report-global-summary-bar">
                        <div class="report-global-summary-item">
                            <span class="report-global-summary-lbl">全体分析の視点:</span>
                            <span class="report-global-summary-val">属性（年代・性別等）に分ける前の、キーワード関連意見全体（${data.totalMatched.toLocaleString()}件）の語彙全体像</span>
                        </div>
                        <div class="report-global-summary-item">
                            <span class="report-global-summary-lbl">語彙規模:</span>
                            <span class="report-global-summary-val">総単語数 <b>${data.totalWordTokens ? data.totalWordTokens.toLocaleString() : '-'}語</b> / 異なり語彙数 <b>${data.vocabCount ? data.vocabCount.toLocaleString() : '-'}語</b></span>
                        </div>
                    </div>

                    <div class="report-dual-grid">
                        <!-- 左: ワードクラウド -->
                        <div class="report-card">
                            <div class="report-card-title">
                                <span>☁️ 5-A. 意見全体の頻出語（ワードクラウド）</span>
                                <span class="report-card-sub-tag">全体状況</span>
                            </div>
                            <div class="report-chart-box" style="height: 56mm;">
                                ${images.cloudImg ? `<img src="${images.cloudImg}" class="report-chart-img" alt="ワードクラウド" />` : `<div class="report-no-chart">画像がありません</div>`}
                            </div>
                            <div class="report-hint-box" style="margin-top: 3px;">
                                💡 属性毎に分解する前の、意見全体で多用された言葉のボリューム感（文字サイズ＝出現頻度）
                            </div>
                        </div>

                        <!-- 右: 単語共起ネットワーク -->
                        <div class="report-card">
                            <div class="report-card-title">
                                <span>🌐 5-B. 単語共起ネットワーク（全体の話題構造）</span>
                                <span class="report-card-sub-tag">全体状況</span>
                            </div>
                            <div class="report-chart-box" style="height: 56mm;">
                                ${globalNetImg ? `<img src="${globalNetImg}" class="report-chart-img" alt="全体共起ネットワーク" />` : `<div class="report-no-chart">画像がありません</div>`}
                            </div>
                            <div class="report-hint-box" style="margin-top: 3px;">
                                💡 キーワード関連意見全体で、どの単語とどの単語が同時に語られているかの文脈クラスタ・話題マップ
                            </div>
                        </div>
                    </div>
                </div>

                <!-- (6) 【全体状況】頻出・特異語彙 ＆ 意見分布構造（UMAP） -->
                <div class="report-section" style="flex: 1; display: flex; flex-direction: column;">
                    <div class="report-sec-title">
                        <span>📊 6. 【全体状況】頻出・特異語彙 ＆ 意見分布構造（UMAP） [属性毎ではない全体状況 / 対象: 🎯「${this.escape(data.targetKeyword)}」]</span>
                    </div>

                    <div class="report-dual-grid" style="grid-template-columns: 0.88fr 1.12fr; flex: 1;">
                        <!-- 左: 頻出単語表 (Top 15) ＆ 全体比特異語 -->
                        <div class="report-card" style="justify-content: space-between;">
                            <div>
                                <div class="report-card-title">
                                    <span>📊 6-A. 意見全体の頻出単語 Top 15 ＆ 全体比特異語</span>
                                    <span class="report-card-sub-tag">全体状況</span>
                                </div>
                                <table class="report-table" style="font-size: 8px;">
                                    <thead>
                                        <tr>
                                            <th style="width: 26px; text-align: center; padding: 2px 3px;">順位</th>
                                            <th style="padding: 2px 3px;">抽出単語</th>
                                            <th style="width: 50px; text-align: right; padding: 2px 3px;">出現件数</th>
                                            <th style="width: 44px; text-align: right; padding: 2px 3px;">出現率</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${topWordsRows}
                                    </tbody>
                                </table>
                            </div>
                            ${oddsKeywordsHtml}
                        </div>

                        <!-- 右: UMAP散布図（大画面表示） ＆ 主要クラスタ傾向表 -->
                        <div class="report-card" style="justify-content: space-between;">
                            <div>
                                <div class="report-card-title">
                                    <span>🌌 6-B. 発言の意味的類似度マップ（UMAP散布図 ＆ 主要クラスタ）</span>
                                    <span class="report-card-sub-tag">全体状況</span>
                                </div>
                                <div class="report-chart-box" style="height: 68mm;">
                                    ${images.umapImg ? `<img src="${images.umapImg}" class="report-chart-img" alt="UMAP散布図" />` : `<div class="report-no-chart">画像がありません</div>`}
                                </div>
                                ${clustersHtml}
                            </div>
                            <div class="report-hint-box" style="margin-top: 3px;">
                                💡 各プロットは1件の発言を表し、距離が近い発言ほど意味・文脈が類似しています。
                            </div>
                        </div>
                    </div>
                </div>

                <!-- ページ2 フッター -->
                <div class="report-footer">
                    <span>キーワード連想＆意見深掘りツール (Focus Explorer)</span>
                    <span>2 / 3</span>
                </div>
            </div>
        `;


        // =========================================================================
        // 📄 ページ3: 属性情報とキーワード関連語の関係（セグメント深掘り・属性別集約） (3/3)
        // =========================================================================
        const page3 = `
            <div class="report-page" id="reportPage3">
                <!-- ページ3 ヘッダー -->
                <div class="report-header">
                    <div class="report-header-main">
                        <div class="report-title-badge">FOCUS EXPLORER REPORT (3/3)</div>
                        <h2 class="report-title">属性情報とキーワード関連語の関係（属性別ネットワーク ＆ クロス分析）</h2>
                    </div>
                    <div class="report-header-meta">
                        <div><b>対象キーワード:</b> 🎯「${this.escape(data.targetKeyword)}」</div>
                        <div><b>整理属性:</b> 👥「${this.escape(data.attrCol)}」</div>
                    </div>
                </div>

                <!-- (7) 【属性ごとの状況】属性別 結びつきネットワーク（特徴語重視 ＆ 頻度重視） -->
                <div class="report-section" style="margin-bottom: 5px;">
                    <div class="report-sec-title">
                        <span>👥 7. 【属性ごとの状況】属性別 結びつきネットワーク（特徴語重視 ＆ 頻度重視） [整理属性: 👥「${this.escape(data.attrCol)}」 / 対象: 🎯「${this.escape(data.targetKeyword)}」]</span>
                    </div>
                    ${attrNetworkSectionHtml}
                </div>

                <!-- (8) 【属性ごとの状況】属性別クロス集計 ＆ 属性項目ごとの代表的な意見 -->
                <div class="report-section" style="flex: 1; display: flex; flex-direction: column;">
                    <div class="report-sec-title">
                        <span>📈 8. 【属性ごとの状況】属性別クロス集計 ＆ 属性項目ごとの代表意見 [整理属性: 👥「${this.escape(data.attrCol)}」 / 対象: 🎯「${this.escape(data.targetKeyword)}」]</span>
                    </div>
                    
                    <!-- 中段: グラフ ＆ クロス集計詳細表 -->
                    <div class="report-dual-grid" style="margin-bottom: 4px;">
                        <!-- 左: グラフ -->
                        <div class="report-card">
                            <div class="report-card-title">
                                <span>📈 8-A. 属性「${this.escape(data.attrCol)}」別の言及傾向グラフ</span>
                            </div>
                            <div class="report-chart-box" style="height: 30mm;">
                                ${images.attrImg ? `<img src="${images.attrImg}" class="report-chart-img" alt="属性グラフ" />` : `<div class="report-no-chart">${data.attrCol !== '（属性列未設定）' ? 'グラフ準備中' : '属性列が未選択です'}</div>`}
                            </div>
                        </div>

                        <!-- 右: クロス集計表 -->
                        <div class="report-card">
                            <div class="report-card-title">
                                <span>📋 8-B. 属性クロス集計詳細表</span>
                            </div>
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

                    <!-- 下段: 属性項目ごとの代表的な意見（生の声） -->
                    <div class="report-attr-rep-wrap" style="flex: 1; display: flex; flex-direction: column; margin-top: 2px;">
                        <div class="report-sub-title" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px;">
                            <span>💬 8-C. 属性項目ごとの代表的な意見（生の声）:</span>
                            <span style="font-size: 8px; color: #64748b; font-weight: normal;">各属性カテゴリで最も適合度の高い代表的な発言を抜粋</span>
                        </div>
                        ${attrRepOpinionsHtml}
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
