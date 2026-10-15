/**
 * メインオーケストレーションスクリプト (app.js)
 * 画面UIイベント、形態素解析、キーワード関連語抽出、
 * 各種可視化の制御を一元管理する
 */

const AppState = {
    rawRows: [],
    headers: [],
    fileName: '',
    textCol: '',
    attrCol: '',
    tokensPerDoc: [], // 全行の形態素トークン
    isTokenized: false,
    
    // キーワード ＆ 関連語
    targetKeyword: '',
    resolvedTargetWord: '', // 複合語（例: 中東情勢）自動判定による中心代表語
    relatedWords: [], // [{ word, score, coocCount, docCount, checked }]
    
    // 抽出結果
    filterResult: null, // { totalDocs, matchedCount, matchRate, matchedDocs }
    subcorpusStats: null, // { wordList, wordCounts, docFreq, coocCounts }
    
    // 解析フィルター設定（text-analysis-test準拠）
    filterOptions: {
        posNoun: true,
        posVerb: true,
        posAdj: true,
        posAdv: false,
        mergeCompoundNouns: true,
        useDefaultStopwords: true
    },
    totalCorpusStats: null, // 全体規模統計（文数・文字数・総単語数・語彙数・品詞別）
    coverageStats: null,    // 全体 vs 対象のカバレッジ比較統計
    
    // 抽出条件設定
    matchMode: 'or',       // 'or' | 'and'
    extractUnit: 'doc',    // 'doc' | 'sentence'
    
    // 要約・集約データ
    summaryData: null,

    // UI状態
    activeTab: 'summary', // 初期タブを要約サマリーに
    opinionsSort: 'relevance', // 'relevance' | 'original' | 'lengthDesc'
    opinionsTypeFilter: 'all', // 'all' | 'issue' | 'request' | 'positive' | 'neutral'
    cloudRanking: 'count',
    cloudMaxWords: 60,
    networkMaxWords: 40,
    networkSpacing: 'wide',
    networkFontSize: 'large',
    umapMode: 'words',
    umapSpread: 'wide',
    umapFontSize: 'large'
};

document.addEventListener('DOMContentLoaded', async () => {
    // 1. 各ビジュアライザーの初期化
    WordCloudVisualizer.init('cloudCanvas');
    NetworkVisualizer.init('networkCanvas');
    UmapVisualizer.init('umapCanvas');
    AttrChartVisualizer.init('attrChartContainer');

    // 2. UIイベントリスナーの登録（即座に操作可能にする）
    setupUIEvents();

    // 3. Kuromoji 形態素解析器の非同期事前準備（バックグラウンドでロード）
    try {
        await TextPreprocessor.init('lib/kuromoji/dict/');
        console.log('Kuromoji initialized successfully.');
    } catch (e) {
        console.warn('Kuromoji init fallback/warning:', e);
    }
});

/**
 * UIイベントリスナーのセットアップ
 */
function setupUIEvents() {
    // 抽出条件（AND/OR）ラジオボタン切り替え
    document.querySelectorAll('input[name="radioMatchMode"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            AppState.matchMode = e.target.value;
            if (AppState.rawRows.length > 0 && AppState.targetKeyword) {
                executeFilteringAndRender();
            }
        });
    });

    // 抽出単位（回答全体 vs 文単位）ラジオボタン切り替え
    document.querySelectorAll('input[name="radioExtractUnit"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            AppState.extractUnit = e.target.value;
            if (AppState.rawRows.length > 0 && AppState.targetKeyword) {
                executeFilteringAndRender();
            }
        });
    });

    // 要約Markdownコピーボタン
    const btnCopyMd = document.getElementById('btnCopyMarkdownSummary');
    if (btnCopyMd) {
        btnCopyMd.addEventListener('click', () => {
            if (!AppState.summaryData || !OpinionSummarizer) return;
            const mdText = OpinionSummarizer.generateMarkdownReport(AppState.summaryData);
            navigator.clipboard.writeText(mdText).then(() => {
                const toast = document.getElementById('copySummaryToast');
                if (toast) {
                    toast.style.display = 'inline';
                    setTimeout(() => { toast.style.display = 'none'; }, 3000);
                }
            }).catch(err => {
                console.error('Copy markdown error:', err);
                alert('クリップボードへのコピーに失敗しました。');
            });
        });
    }

    // 意見一覧ソート切り替え
    const selectSort = document.getElementById('selectOpinionsSort');
    if (selectSort) {
        selectSort.addEventListener('change', (e) => {
            AppState.opinionsSort = e.target.value;
            renderOpinionsList(document.getElementById('inputFilterOpinionText').value || '');
        });
    }

    // 意見一覧タイプフィルター切り替え
    const selectTypeFilter = document.getElementById('selectOpinionsTypeFilter');
    if (selectTypeFilter) {
        selectTypeFilter.addEventListener('change', (e) => {
            AppState.opinionsTypeFilter = e.target.value;
            renderOpinionsList(document.getElementById('inputFilterOpinionText').value || '');
        });
    }
    // タブ切り替え（ファイル読込 vs コピペ）
    const tabFile = document.getElementById('tabInputFile');
    const tabPaste = document.getElementById('tabInputPaste');
    const dropWrapper = document.getElementById('dropZoneWrapper');
    const pasteWrapper = document.getElementById('pasteZoneWrapper');

    tabFile.addEventListener('click', () => {
        tabFile.classList.add('active');
        tabPaste.classList.remove('active');
        dropWrapper.style.display = 'block';
        pasteWrapper.style.display = 'none';
    });

    tabPaste.addEventListener('click', () => {
        tabPaste.classList.add('active');
        tabFile.classList.remove('active');
        dropWrapper.style.display = 'none';
        pasteWrapper.style.display = 'block';
    });

    // ファイルドラッグ＆ドロップ
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('csvFileInput');

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add('dragover');
        });
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('dragover');
        });
    });

    dropZone.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
            handleFileUpload(files[0]);
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
            handleFileUpload(e.target.files[0]);
        }
    });

    // コピペ入力
    const pasteArea = document.getElementById('pasteTextarea');
    const pasteStats = document.getElementById('pasteStatsInfo');
    pasteArea.addEventListener('input', () => {
        const lines = pasteArea.value.trim().split(/\r?\n/).filter(l => l.trim().length > 0);
        pasteStats.textContent = lines.length > 0 ? `${lines.length} 行のテキストが入力されています` : 'データが入力されていません';
    });

    document.getElementById('btnClearPaste').addEventListener('click', () => {
        pasteArea.value = '';
        pasteStats.textContent = 'データが入力されていません';
    });

    document.getElementById('btnLoadPaste').addEventListener('click', () => {
        const text = pasteArea.value.trim();
        if (!text) {
            alert('貼り付けエリアにテキストを入力してください。');
            return;
        }
        const hasHeader = document.getElementById('checkPasteHasHeader').checked;
        const parsed = CsvParser.parseTextContent(text, 'pasted_data.txt', hasHeader);
        loadParsedData(parsed);
    });

    // デモデータボタン
    document.getElementById('btnDemoData').addEventListener('click', () => {
        loadDemoData();
    });

    // 列選択変更
    document.getElementById('selectTextCol').addEventListener('change', (e) => {
        AppState.textCol = e.target.value;
        AppState.isTokenized = false; // テキスト列が変わったら再トークン化
        runFocusAnalysis();
    });

    document.getElementById('selectAttrCol').addEventListener('change', (e) => {
        AppState.attrCol = e.target.value;
        updateVisualizations();
    });

    // キーワード実行ボタン
    document.getElementById('btnRunFocus').addEventListener('click', async () => {
        const kw = document.getElementById('inputTargetKeyword').value.trim();
        if (!kw) {
            alert('注目したいキーワードを入力してください。');
            return;
        }

        if (!AppState.rawRows.length || !AppState.textCol) {
            const useDemo = confirm('アンケートデータが読み込まれていません。デモデータ（物価高・生活意識アンケート）を読み込んで分析しますか？');
            if (useDemo) {
                loadDemoData();
            }
            return;
        }

        AppState.targetKeyword = kw;
        await runFocusAnalysis();
    });

    document.getElementById('inputTargetKeyword').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('btnRunFocus').click();
        }
    });

    // 関連語全選択 / 全解除
    document.getElementById('btnSelectAllRelated').addEventListener('click', () => {
        AppState.relatedWords.forEach(r => { r.checked = true; });
        renderRelatedChips();
        executeFilteringAndRender();
    });

    document.getElementById('btnDeselectAllRelated').addEventListener('click', () => {
        AppState.relatedWords.forEach(r => { r.checked = false; });
        renderRelatedChips();
        executeFilteringAndRender();
    });

    // ダッシュボードタブ切り替え
    const navTabs = document.querySelectorAll('.nav-tab-btn');
    navTabs.forEach(btn => {
        btn.addEventListener('click', () => {
            navTabs.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const tabName = btn.getAttribute('data-tab');
            switchTab(tabName);
        });
    });

    // ワードクラウド設定
    document.getElementById('selectCloudRanking').addEventListener('change', (e) => {
        AppState.cloudRanking = e.target.value;
        updateWordCloud();
    });
    document.getElementById('selectCloudMaxWords').addEventListener('change', (e) => {
        AppState.cloudMaxWords = parseInt(e.target.value, 10);
        updateWordCloud();
    });

    // ネットワーク設定
    document.getElementById('selectNetworkMaxWords').addEventListener('change', (e) => {
        AppState.networkMaxWords = parseInt(e.target.value, 10);
        updateNetwork();
    });
    const selectSpacing = document.getElementById('selectNetworkSpacing');
    if (selectSpacing) {
        selectSpacing.addEventListener('change', (e) => {
            AppState.networkSpacing = e.target.value;
            updateNetwork();
        });
    }
    const selectNetFontSize = document.getElementById('selectNetworkFontSize');
    if (selectNetFontSize) {
        selectNetFontSize.addEventListener('change', (e) => {
            AppState.networkFontSize = e.target.value;
            updateNetwork();
        });
    }

    const btnNetZoomIn = document.getElementById('btnNetworkZoomIn');
    if (btnNetZoomIn) {
        btnNetZoomIn.addEventListener('click', () => NetworkVisualizer.zoomIn());
    }
    const btnNetZoomOut = document.getElementById('btnNetworkZoomOut');
    if (btnNetZoomOut) {
        btnNetZoomOut.addEventListener('click', () => NetworkVisualizer.zoomOut());
    }
    const btnNetReset = document.getElementById('btnNetworkReset');
    if (btnNetReset) {
        btnNetReset.addEventListener('click', () => {
            NetworkVisualizer.resetZoom();
            updateNetwork();
        });
    }

    // UMAP設定
    document.getElementById('selectUmapMode').addEventListener('change', (e) => {
        AppState.umapMode = e.target.value;
        updateUmap();
    });
    const selectSpread = document.getElementById('selectUmapSpread');
    if (selectSpread) {
        selectSpread.addEventListener('change', (e) => {
            AppState.umapSpread = e.target.value;
            updateUmap();
        });
    }
    const selectUmapFontSize = document.getElementById('selectUmapFontSize');
    if (selectUmapFontSize) {
        selectUmapFontSize.addEventListener('change', (e) => {
            AppState.umapFontSize = e.target.value;
            updateUmap();
        });
    }
    const btnUmapZoomIn = document.getElementById('btnUmapZoomIn');
    if (btnUmapZoomIn) {
        btnUmapZoomIn.addEventListener('click', () => UmapVisualizer.zoomIn());
    }
    const btnUmapZoomOut = document.getElementById('btnUmapZoomOut');
    if (btnUmapZoomOut) {
        btnUmapZoomOut.addEventListener('click', () => UmapVisualizer.zoomOut());
    }
    const btnUmapReset = document.getElementById('btnUmapReset');
    if (btnUmapReset) {
        btnUmapReset.addEventListener('click', () => {
            UmapVisualizer.resetZoom();
            updateUmap();
        });
    }

    // 解析フィルター設定（品詞・複合語・除外語）の変更イベント
    const updateFiltersAndReanalyze = () => {
        const cNoun = document.getElementById('checkPosNoun');
        const cVerb = document.getElementById('checkPosVerb');
        const cAdj  = document.getElementById('checkPosAdj');
        const cAdv  = document.getElementById('checkPosAdv');
        const cMerge = document.getElementById('checkMergeNouns');
        const cStop  = document.getElementById('checkUseStopwords');

        if (cNoun) AppState.filterOptions.posNoun = cNoun.checked;
        if (cVerb) AppState.filterOptions.posVerb = cVerb.checked;
        if (cAdj)  AppState.filterOptions.posAdj = cAdj.checked;
        if (cAdv)  AppState.filterOptions.posAdv = cAdv.checked;
        if (cMerge) AppState.filterOptions.mergeCompoundNouns = cMerge.checked;
        if (cStop)  AppState.filterOptions.useDefaultStopwords = cStop.checked;

        TextPreprocessor.options = { ...AppState.filterOptions };
        AppState.isTokenized = false; // 再トークナイズ必要

        if (AppState.rawRows.length > 0 && AppState.textCol) {
            runFocusAnalysis();
        }
    };

    ['checkPosNoun', 'checkPosVerb', 'checkPosAdj', 'checkPosAdv', 'checkMergeNouns', 'checkUseStopwords'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', updateFiltersAndReanalyze);
    });

    // フィルターバー内の辞書編集ボタン
    const btnOpenFilter = document.getElementById('btnOpenDictFilter');
    if (btnOpenFilter) {
        btnOpenFilter.addEventListener('click', () => {
            document.getElementById('btnOpenDict').click();
        });
    }

    // カバレッジ統計の品詞別詳細アコーディオントグル
    const btnTogglePos = document.getElementById('btnTogglePosDetail');
    const posDetailBox = document.getElementById('coveragePosDetail');
    if (btnTogglePos && posDetailBox) {
        btnTogglePos.addEventListener('click', () => {
            const isHidden = posDetailBox.style.display === 'none';
            posDetailBox.style.display = isHidden ? 'block' : 'none';
            btnTogglePos.textContent = isHidden ? '品詞別内訳を閉じる ▲' : '品詞別内訳を表示 ▼';
        });
    }

    // 意見内検索フィルタ
    document.getElementById('inputFilterOpinionText').addEventListener('input', (e) => {
        renderOpinionsList(e.target.value);
    });

    // 抽出意見CSVダウンロード
    document.getElementById('btnExportMatchedCsv').addEventListener('click', () => {
        exportMatchedOpinionsCsv();
    });

    // 各図の個別画像保存 ＆ クリップボードコピー（Word/PowerPoint向け）
    const bindExport = (btnId, type, action) => {
        const el = document.getElementById(btnId);
        if (el) el.addEventListener('click', () => exportChart(type, action));
    };

    bindExport('btnSaveCloudImage', 'cloud', 'download');
    bindExport('btnCopyCloudImage', 'cloud', 'copy');
    bindExport('btnSaveNetworkImage', 'network', 'download');
    bindExport('btnCopyNetworkImage', 'network', 'copy');
    bindExport('btnSaveUmapImage', 'umap', 'download');
    bindExport('btnCopyUmapImage', 'umap', 'copy');
    bindExport('btnSaveAttrImage', 'attr', 'download');
    bindExport('btnCopyAttrImage', 'attr', 'copy');

    // ツールバー右端の「表示中の図を保存」ボタン
    const btnSaveCurrent = document.getElementById('btnSaveImage');
    if (btnSaveCurrent) {
        btnSaveCurrent.addEventListener('click', () => {
            exportChart(AppState.activeTab, 'download');
        });
    }

    // レポート印刷
    document.getElementById('btnPrintReport').addEventListener('click', () => {
        window.print();
    });

    // 辞書モーダル
    setupDictModalEvents();

    // ヘルプモーダル
    const helpModal = document.getElementById('helpModal');
    document.getElementById('btnHelp').addEventListener('click', () => {
        helpModal.style.display = 'flex';
    });
    document.getElementById('btnCloseHelpModal').addEventListener('click', () => {
        helpModal.style.display = 'none';
    });
    document.getElementById('btnCloseHelpOk').addEventListener('click', () => {
        helpModal.style.display = 'none';
    });
}

/**
 * ファイルアップロードの処理
 */
async function handleFileUpload(file) {
    try {
        const parsed = await CsvParser.parse(file);
        loadParsedData(parsed);
    } catch (err) {
        alert('ファイルの読み込みに失敗しました: ' + err.message);
    }
}

/**
 * パース済みデータのロード
 */
function loadParsedData(parsed) {
    AppState.rawRows = parsed.rows || [];
    AppState.headers = parsed.headers || [];
    AppState.fileName = parsed.fileName || 'data.csv';
    AppState.isTokenized = false;

    // ファイルステータス表示
    document.getElementById('fileStatusBar').style.display = 'flex';
    document.getElementById('fileNameDisplay').textContent = `📄 ${AppState.fileName}`;
    document.getElementById('fileRowsDisplay').textContent = `${AppState.rawRows.length} 件の回答を読み込みました`;

    // 列選択セレクトボックスの構築
    const textSelect = document.getElementById('selectTextCol');
    const attrSelect = document.getElementById('selectAttrCol');
    textSelect.innerHTML = '';
    attrSelect.innerHTML = '<option value="">（属性なし・全体集計）</option>';

    AppState.headers.forEach(h => {
        const opt1 = document.createElement('option');
        opt1.value = h;
        opt1.textContent = h;
        textSelect.appendChild(opt1);

        const opt2 = document.createElement('option');
        opt2.value = h;
        opt2.textContent = h;
        attrSelect.appendChild(opt2);
    });

    // 列の自動推測（自由記述列・属性列）
    let guessedText = AppState.headers[0];
    let maxAvgLen = 0;
    AppState.headers.forEach(h => {
        const lens = AppState.rawRows.slice(0, 30).map(r => String(r[h] || '').length);
        const avg = lens.reduce((a, b) => a + b, 0) / (lens.length || 1);
        if (avg > maxAvgLen) {
            maxAvgLen = avg;
            guessedText = h;
        }
    });
    textSelect.value = guessedText;
    AppState.textCol = guessedText;

    // 属性列の推測（年代、性別、カテゴリ、満足度など）
    const attrCandidates = ['年代', '年齢', '性別', 'カテゴリ', '区分', '属性', '満足度', '地域'];
    const guessedAttr = AppState.headers.find(h => attrCandidates.some(c => h.includes(c)));
    if (guessedAttr && guessedAttr !== guessedText) {
        attrSelect.value = guessedAttr;
        AppState.attrCol = guessedAttr;
    } else {
        attrSelect.value = '';
        AppState.attrCol = '';
    }

    // プレビュー表示
    renderPreviewTable();

    // 設定パネル・キーワードセクションを表示
    document.getElementById('configGrid').style.display = 'block';
    document.getElementById('focusSection').style.display = 'block';

    const currentKw = (document.getElementById('inputTargetKeyword').value || '').trim();
    if (currentKw) {
        AppState.targetKeyword = currentKw;
        runFocusAnalysis();
    } else {
        // キーワードが空の場合は待機状態にする（ユーザーの入力を促す）
        AppState.targetKeyword = '';
        AppState.resolvedTargetWord = '';
        AppState.relatedWords = [];
        document.getElementById('dashboardSection').style.display = 'none';
        document.getElementById('coveragePanel').style.display = 'none';
        const chipsContainer = document.getElementById('relatedChipsContainer');
        if (chipsContainer) {
            chipsContainer.innerHTML = '<span style="color: var(--text-muted); font-size: 13px;">注目したいキーワードを入力して「🚀 関連語を探索 ＆ 分析」をクリックしてください</span>';
        }
    }
}

/**
 * プレビューテーブルの描画
 */
function renderPreviewTable() {
    const table = document.getElementById('previewTable');
    table.innerHTML = '';

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    AppState.headers.forEach(h => {
        const th = document.createElement('th');
        th.textContent = h;
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    AppState.rawRows.slice(0, 5).forEach(row => {
        const tr = document.createElement('tr');
        AppState.headers.forEach(h => {
            const td = document.createElement('td');
            const val = String(row[h] || '');
            td.textContent = val.length > 50 ? val.substring(0, 50) + '…' : val;
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    document.getElementById('previewCountText').textContent = `全 ${AppState.rawRows.length} 件`;
}

/**
 * デモデータのロード
 */
function loadDemoData() {
    if (typeof DEMO_SURVEY_DATA === 'undefined') return;
    const headers = ['id', '年代', '自由記述'];
    // デモ実行時は例として「物価高」を設定して分析を即座に体験可能にする
    document.getElementById('inputTargetKeyword').value = '物価高';
    AppState.targetKeyword = '物価高';
    loadParsedData({
        headers: headers,
        rows: DEMO_SURVEY_DATA,
        fileName: '物価高・生活意識アンケート (デモデータ)'
    });
}

/**
 * キーワード ＆ 関連語探索の実行
 */
async function runFocusAnalysis() {
    if (!AppState.rawRows.length || !AppState.textCol) return;

    const kwInput = document.getElementById('inputTargetKeyword');
    const kw = kwInput ? kwInput.value.trim() : '';
    if (!kw) {
        alert('注目したいキーワードを入力してください。');
        return;
    }
    AppState.targetKeyword = kw;

    const btn = document.getElementById('btnRunFocus');
    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '⏳ 分析中...';
    }

    try {
        // 1. Kuromoji が未完了の場合は待機を試みる
        if (!TextPreprocessor.tokenizer) {
            try {
                await TextPreprocessor.init('lib/kuromoji/dict/');
            } catch (e) {
                console.warn('Tokenizer init fallback used:', e);
            }
        }

        // 2. 必要に応じて全行の形態素解析を実施
        if (!AppState.isTokenized) {
            TextPreprocessor.options = { ...AppState.filterOptions };
            const texts = AppState.rawRows.map(r => String(r[AppState.textCol] || ''));
            AppState.tokensPerDoc = TextPreprocessor.tokenizeDocuments(texts, AppState.filterOptions);
            AppState.totalCorpusStats = TextPreprocessor.computeCorpusStats(AppState.rawRows, AppState.textCol, AppState.tokensPerDoc);
            AppState.isTokenized = true;
        }

        // 3. キーワード関連語の算出
        const res = AssociationEngine.findRelatedWords(
            AppState.tokensPerDoc,
            AppState.rawRows,
            AppState.textCol,
            AppState.targetKeyword,
            { topN: 14, minCooc: 2 }
        );

        if (res.warning) {
            alert(res.warning);
        }

        AppState.resolvedTargetWord = res.resolvedTargetWord || AppState.targetKeyword;
        AppState.relatedWords = res.relatedWords || [];

        // 4. 関連語チップの描画
        renderRelatedChips();

        // 5. 該当意見のフィルタリング ＆ 可視化描画
        executeFilteringAndRender();
    } catch (err) {
        console.error('Focus analysis error:', err);
        alert('分析処理中にエラーが発生しました: ' + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText || '🚀 関連語を探索 ＆ 分析';
        }
    }
}

/**
 * 関連語チップ群の描画
 */
function renderRelatedChips() {
    const container = document.getElementById('relatedChipsContainer');
    container.innerHTML = '';

    // 複合語の自動判定により代表中心語が設定された場合、案内バッジを先頭に表示
    if (AppState.resolvedTargetWord && AppState.resolvedTargetWord !== AppState.targetKeyword) {
        const infoBadge = document.createElement('div');
        infoBadge.className = 'resolved-target-badge';
        infoBadge.style.cssText = 'background: #fff1f2; border: 1px solid #fecdd3; border-radius: 8px; padding: 6px 12px; margin-bottom: 8px; font-size: 13px; color: #9f1239; display: flex; align-items: center; gap: 8px;';
        infoBadge.innerHTML = `
            <span>🎯</span>
            <span>代表中心語: <strong>${escapeHtml(AppState.resolvedTargetWord)}</strong>（キーワード「${escapeHtml(AppState.targetKeyword)}」を内包する複合語として自動判別・中心配置）</span>
        `;
        container.appendChild(infoBadge);
    }

    if (!AppState.relatedWords.length) {
        const noMsg = document.createElement('div');
        noMsg.style.cssText = 'color: var(--text-muted); font-size: 13px; padding: 4px 0;';
        noMsg.textContent = '共起する関連語が見つかりませんでした。別のキーワードをお試しください。';
        container.appendChild(noMsg);
        return;
    }

    const chipsWrapper = document.createElement('div');
    chipsWrapper.style.cssText = 'display: flex; flex-wrap: wrap; gap: 8px; align-items: center;';

    AppState.relatedWords.forEach((rw, idx) => {
        const chip = document.createElement('div');
        chip.className = `related-chip ${rw.checked ? 'active' : ''}`;
        chip.innerHTML = `
            <span>${rw.checked ? '☑' : '☐'}</span>
            <span>${rw.word}</span>
            <span class="related-chip-score">${rw.jaccard.toFixed(2)}</span>
        `;

        chip.addEventListener('click', () => {
            rw.checked = !rw.checked;
            chip.classList.toggle('active', rw.checked);
            chip.querySelector('span:first-child').textContent = rw.checked ? '☑' : '☐';
            executeFilteringAndRender();
        });

        chipsWrapper.appendChild(chip);
    });
    container.appendChild(chipsWrapper);
}

/**
 * 対象意見の抽出 ＆ 描画
 */
function executeFilteringAndRender() {
    const activeRelated = AppState.relatedWords.filter(r => r.checked).map(r => r.word);

    // 1. 意見フィルタリング（AND/OR条件、文単位/回答単位を適用）
    AppState.filterResult = AssociationEngine.filterMatchedOpinions(
        AppState.rawRows,
        AppState.textCol,
        AppState.attrCol,
        AppState.targetKeyword,
        activeRelated,
        AppState.tokensPerDoc,
        {
            resolvedTargetWord: AppState.resolvedTargetWord,
            matchMode: AppState.matchMode,
            extractUnit: AppState.extractUnit
        }
    );

    // 2. 抽出サマリーの更新
    const res = AppState.filterResult;
    document.getElementById('tabOpinionCount').textContent = res.matchedCount;

    // 3. 抽出意見群の統計集計
    AppState.subcorpusStats = AssociationEngine.computeSubcorpusStats(
        res.matchedDocs,
        TextPreprocessor.DEFAULT_STOPWORDS,
        80,
        {
            targetKeyword: AppState.targetKeyword,
            resolvedTargetWord: AppState.resolvedTargetWord
        }
    );

    // 4. 全体規模 vs 分析対象（カバレッジ統計）の算出 ＆ レンダリング
    if (AppState.totalCorpusStats) {
        AppState.coverageStats = AssociationEngine.computeCoverageStats(
            AppState.totalCorpusStats,
            res.matchedDocs,
            AppState.subcorpusStats
        );
        renderCoveragePanel(AppState.coverageStats);
    }

    // 5. 意見集約・論点サマリーデータの生成
    generateSummaryData();

    // ダッシュボードを表示
    document.getElementById('dashboardSection').style.display = 'block';

    // 6. 現在のタブの可視化を更新
    updateVisualizations();
}

/**
 * 意見集約・論点サマリーデータの生成
 */
function generateSummaryData() {
    if (!AppState.filterResult || !OpinionSummarizer) return;
    const docs = AppState.filterResult.matchedDocs;
    const D = docs.length;

    // 1. 意見タイプの集計
    const typeCounts = { issue: 0, request: 0, positive: 0, neutral: 0 };
    docs.forEach(d => {
        const t = (d.opinionType && d.opinionType.type) ? d.opinionType.type : 'neutral';
        if (typeCounts[t] !== undefined) typeCounts[t]++;
        else typeCounts.neutral++;
    });

    const issueRate = D > 0 ? Math.round((typeCounts.issue / D) * 1000) / 10 : 0;
    const requestRate = D > 0 ? Math.round((typeCounts.request / D) * 1000) / 10 : 0;
    const positiveRate = D > 0 ? Math.round((typeCounts.positive / D) * 1000) / 10 : 0;
    const neutralRate = D > 0 ? Math.round((typeCounts.neutral / D) * 1000) / 10 : 0;

    const opinionTypeSummary = {
        issueCount: typeCounts.issue,
        issueRate: issueRate,
        requestCount: typeCounts.request,
        requestRate: requestRate,
        positiveCount: typeCounts.positive,
        positiveRate: positiveRate,
        neutralCount: typeCounts.neutral,
        neutralRate: neutralRate
    };

    // 2. 全体代表意見（抽出型要約）の選出
    const repOpinions = OpinionSummarizer.extractRepresentativeOpinions(docs, AppState.subcorpusStats, 4);

    // 3. 論点（トピッククラスタ）サマリーの生成
    let topicSummaries = [];
    if (D >= 2) {
        const kClusters = Math.min(4, Math.max(2, Math.floor(Math.sqrt(D / 3.0))));
        // 簡易文書ベクトルの構築とクラスタ割り当て
        const featureWords = (AppState.subcorpusStats && AppState.subcorpusStats.wordList)
            ? AppState.subcorpusStats.wordList.slice(0, 40).map(w => w.text)
            : [];
        const F = featureWords.length;
        const wIdx = new Map(featureWords.map((w, idx) => [w, idx]));

        const docVectors = docs.map(doc => {
            const vec = new Float64Array(F);
            (doc.tokens || []).forEach(t => {
                if (wIdx.has(t)) vec[wIdx.get(t)] += 1;
            });
            let norm = 0;
            for (let f = 0; f < F; f++) norm += vec[f] * vec[f];
            norm = Math.sqrt(norm);
            if (norm > 0) {
                for (let f = 0; f < F; f++) vec[f] /= norm;
            }
            return vec;
        });

        // K-Means クラスタリング
        const clusterAssignments = runQuickKMeans(docVectors, kClusters);
        topicSummaries = OpinionSummarizer.generateTopicSummaries(docs, AppState.subcorpusStats, clusterAssignments, kClusters);
    }

    // 4. 全体比オッズ比上位キーワードの算出
    const oddsRatioKeywords = OpinionSummarizer.computeOddsRatioKeywords(AppState.totalCorpusStats, AppState.subcorpusStats, 8);

    AppState.summaryData = {
        targetKeyword: AppState.targetKeyword,
        resolvedTargetWord: AppState.resolvedTargetWord,
        filterResult: AppState.filterResult,
        repOpinions: repOpinions,
        topicSummaries: topicSummaries,
        oddsRatioKeywords: oddsRatioKeywords,
        opinionTypeSummary: opinionTypeSummary
    };
}

/**
 * 簡易 K-Means クラスタリング
 */
function runQuickKMeans(vectors, k) {
    const N = vectors.length;
    if (N === 0) return [];
    if (N <= k) return Array.from({ length: N }, (_, i) => i);
    const F = vectors[0].length;
    if (F === 0) return Array.from({ length: N }, () => 0);

    // 中心点初期化 (k-means++ 的に離れた点を選択)
    const centroids = [];
    centroids.push(new Float64Array(vectors[0]));
    for (let c = 1; c < k; c++) {
        let maxD = -1, bestIdx = 0;
        for (let i = 0; i < N; i++) {
            let minD = Infinity;
            for (let m = 0; m < centroids.length; m++) {
                let dot = 0;
                for (let f = 0; f < F; f++) dot += vectors[i][f] * centroids[m][f];
                const d = Math.max(0, 1.0 - dot);
                if (d < minD) minD = d;
            }
            if (minD > maxD) {
                maxD = minD;
                bestIdx = i;
            }
        }
        centroids.push(new Float64Array(vectors[bestIdx]));
    }

    let assignments = new Int32Array(N);
    for (let iter = 0; iter < 12; iter++) {
        let changed = false;
        // 割り当てステップ
        for (let i = 0; i < N; i++) {
            let maxDot = -Infinity, bestC = 0;
            for (let c = 0; c < k; c++) {
                let dot = 0;
                for (let f = 0; f < F; f++) dot += vectors[i][f] * centroids[c][f];
                if (dot > maxDot) {
                    maxDot = dot;
                    bestC = c;
                }
            }
            if (assignments[i] !== bestC) {
                assignments[i] = bestC;
                changed = true;
            }
        }
        if (!changed) break;

        // 中心更新ステップ
        const counts = new Int32Array(k);
        for (let c = 0; c < k; c++) centroids[c].fill(0);
        for (let i = 0; i < N; i++) {
            const c = assignments[i];
            counts[c]++;
            for (let f = 0; f < F; f++) centroids[c][f] += vectors[i][f];
        }
        for (let c = 0; c < k; c++) {
            if (counts[c] > 0) {
                let norm = 0;
                for (let f = 0; f < F; f++) {
                    centroids[c][f] /= counts[c];
                    norm += centroids[c][f] * centroids[c][f];
                }
                norm = Math.sqrt(norm);
                if (norm > 0) {
                    for (let f = 0; f < F; f++) centroids[c][f] /= norm;
                }
            }
        }
    }
    return Array.from(assignments);
}

/**
 * 可視化の更新
 */
function updateVisualizations() {
    if (!AppState.filterResult) return;

    if (AppState.activeTab === 'summary') {
        renderSummaryDashboard();
    } else if (AppState.activeTab === 'cloud') {
        updateWordCloud();
    } else if (AppState.activeTab === 'network') {
        updateNetwork();
    } else if (AppState.activeTab === 'umap') {
        updateUmap();
    } else if (AppState.activeTab === 'attr') {
        updateAttrChart();
    } else if (AppState.activeTab === 'opinions') {
        renderOpinionsList(document.getElementById('inputFilterOpinionText').value || '');
    }
}

/**
 * タブ切り替え
 */
function switchTab(tabName) {
    AppState.activeTab = tabName;

    // 各タブコンテンツの表示/非表示
    const tabContents = {
        summary: 'tabContentSummary',
        cloud: 'tabContentCloud',
        network: 'tabContentNetwork',
        umap: 'tabContentUmap',
        attr: 'tabContentAttr',
        opinions: 'tabContentOpinions'
    };

    Object.entries(tabContents).forEach(([name, id]) => {
        const el = document.getElementById(id);
        if (el) el.style.display = (name === tabName) ? 'block' : 'none';
    });

    // ツールバーコントロールの切り替え
    document.getElementById('toolbarSummaryCtrl').style.display = (tabName === 'summary') ? 'flex' : 'none';
    document.getElementById('toolbarCloudCtrl').style.display = (tabName === 'cloud') ? 'block' : 'none';
    document.getElementById('toolbarNetworkCtrl').style.display = (tabName === 'network') ? 'block' : 'none';
    document.getElementById('toolbarUmapCtrl').style.display = (tabName === 'umap') ? 'block' : 'none';
    const attrCtrl = document.getElementById('toolbarAttrCtrl');
    if (attrCtrl) attrCtrl.style.display = (tabName === 'attr') ? 'block' : 'none';
    document.getElementById('toolbarOpinionsCtrl').style.display = (tabName === 'opinions') ? 'flex' : 'none';

    // 切り替え時に描画
    updateVisualizations();
}

/**
 * ワードクラウド描画
 */
function updateWordCloud() {
    if (!AppState.subcorpusStats) return;
    const activeRelated = AppState.relatedWords.filter(r => r.checked).map(r => r.word);

    WordCloudVisualizer.render(
        AppState.subcorpusStats.wordList,
        AppState.targetKeyword,
        activeRelated,
        {
            resolvedTargetWord: AppState.resolvedTargetWord,
            rankingMethod: AppState.cloudRanking,
            maxWords: AppState.cloudMaxWords,
            onWordClick: (word) => {
                // 単語クリックで生の声一覧へジャンプ
                document.querySelector('.nav-tab-btn[data-tab="opinions"]').click();
                document.getElementById('inputFilterOpinionText').value = word;
                renderOpinionsList(word);
            }
        }
    );
}

/**
 * 共起ネットワーク描画
 */
function updateNetwork() {
    if (!AppState.subcorpusStats) return;
    const activeRelated = AppState.relatedWords.filter(r => r.checked).map(r => r.word);

    NetworkVisualizer.render(
        AppState.subcorpusStats.wordList,
        AppState.subcorpusStats.coocCounts,
        AppState.targetKeyword,
        activeRelated,
        {
            resolvedTargetWord: AppState.resolvedTargetWord,
            maxWords: AppState.networkMaxWords,
            spacingMode: AppState.networkSpacing,
            fontSize: AppState.networkFontSize,
            onWordClick: (word) => {
                document.querySelector('.nav-tab-btn[data-tab="opinions"]').click();
                document.getElementById('inputFilterOpinionText').value = word;
                renderOpinionsList(word);
            }
        }
    );
}

/**
 * UMAP散布図描画
 */
function updateUmap() {
    if (!AppState.subcorpusStats || !AppState.filterResult) return;
    const activeRelated = AppState.relatedWords.filter(r => r.checked).map(r => r.word);

    UmapVisualizer.render(
        AppState.umapMode,
        AppState.subcorpusStats.wordList,
        AppState.subcorpusStats.coocCounts,
        AppState.subcorpusStats.docFreq,
        AppState.filterResult.matchedDocs,
        AppState.targetKeyword,
        activeRelated,
        {
            resolvedTargetWord: AppState.resolvedTargetWord,
            maxWords: 50,
            spreadMode: AppState.umapSpread,
            fontSize: AppState.umapFontSize,
            onPointClick: (point) => {
                if (point.rawDoc) {
                    // 意見プロットクリック時
                    document.querySelector('.nav-tab-btn[data-tab="opinions"]').click();
                    document.getElementById('inputFilterOpinionText').value = (point.rawDoc.matchedWords && point.rawDoc.matchedWords[0]) || '';
                    renderOpinionsList((point.rawDoc.matchedWords && point.rawDoc.matchedWords[0]) || '');
                } else {
                    // 単語プロットクリック時
                    document.querySelector('.nav-tab-btn[data-tab="opinions"]').click();
                    document.getElementById('inputFilterOpinionText').value = point.text;
                    renderOpinionsList(point.text);
                }
            }
        }
    );
}

/**
 * 属性別クロス集計描画
 */
function updateAttrChart() {
    if (!AppState.filterResult) return;
    AttrChartVisualizer.render(
        AppState.rawRows,
        AppState.filterResult.matchedDocs,
        AppState.attrCol,
        AppState.targetKeyword
    );
}

/**
 * 意見集約・論点サマリーダッシュボードの描画
 */
function renderSummaryDashboard() {
    const summary = AppState.summaryData;
    if (!summary) return;

    // 1. 概要サマリーカード
    const overviewEl = document.getElementById('summaryOverviewCard');
    if (overviewEl && summary.opinionTypeSummary) {
        const ots = summary.opinionTypeSummary;
        const res = summary.filterResult;
        overviewEl.innerHTML = `
            <div class="summary-overview-header">
                <div class="summary-overview-title">
                    <span>📊</span>
                    <span>「${escapeHtml(summary.targetKeyword)}」関連意見の集約概要</span>
                    <span style="font-size: 13px; font-weight: normal; color: var(--text-muted);">
                        (${res.matchedCount.toLocaleString()} 件 / 全 ${res.totalDocs.toLocaleString()} 件中 ${res.matchRate.toFixed(1)}%)
                    </span>
                </div>
                <div style="font-size: 12px; color: var(--text-muted);">
                    抽出条件: <strong>${AppState.matchMode === 'and' ? 'AND (キーワード必須＋関連語)' : 'OR (キーワード または 関連語)'}</strong> / 
                    単位: <strong>${AppState.extractUnit === 'sentence' ? '文単位' : '回答全体'}</strong>
                </div>
            </div>
            <div class="summary-type-progress-wrap">
                <div style="font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 6px;">
                    意見タイプ構成比（ルールベース自動分類）:
                </div>
                <div class="summary-type-bars">
                    <div class="summary-type-bar" style="width: ${ots.issueRate}%; background: #e11d48;" title="困りごと・課題: ${ots.issueCount}件 (${ots.issueRate}%)"></div>
                    <div class="summary-type-bar" style="width: ${ots.requestRate}%; background: #0284c7;" title="要望・改善提案: ${ots.requestCount}件 (${ots.requestRate}%)"></div>
                    <div class="summary-type-bar" style="width: ${ots.positiveRate}%; background: #10b981;" title="肯定・満足: ${ots.positiveCount}件 (${ots.positiveRate}%)"></div>
                    <div class="summary-type-bar" style="width: ${ots.neutralRate}%; background: #94a3b8;" title="その他・事実: ${ots.neutralCount}件 (${ots.neutralRate}%)"></div>
                </div>
                <div class="summary-type-legend">
                    <div class="summary-type-legend-item">
                        <span class="legend-dot" style="background: #e11d48;"></span>
                        <span>🔴 困りごと・課題: <strong>${ots.issueCount}件</strong> (${ots.issueRate}%)</span>
                    </div>
                    <div class="summary-type-legend-item">
                        <span class="legend-dot" style="background: #0284c7;"></span>
                        <span>🔵 要望・改善提案: <strong>${ots.requestCount}件</strong> (${ots.requestRate}%)</span>
                    </div>
                    <div class="summary-type-legend-item">
                        <span class="legend-dot" style="background: #10b981;"></span>
                        <span>🟢 肯定・満足: <strong>${ots.positiveCount}件</strong> (${ots.positiveRate}%)</span>
                    </div>
                    <div class="summary-type-legend-item">
                        <span class="legend-dot" style="background: #94a3b8;"></span>
                        <span>⚪ その他・事実: <strong>${ots.neutralCount}件</strong> (${ots.neutralRate}%)</span>
                    </div>
                </div>
            </div>
        `;
    }

    // 2. 代表意見（抽出型要約）カード一覧
    const repListEl = document.getElementById('summaryRepOpinionsList');
    if (repListEl) {
        repListEl.innerHTML = '';
        if (!summary.repOpinions || summary.repOpinions.length === 0) {
            repListEl.innerHTML = `<div style="color: var(--text-muted); font-size: 13px;">代表意見が見つかりませんでした</div>`;
        } else {
            summary.repOpinions.forEach(rep => {
                const doc = rep.doc;
                const card = document.createElement('div');
                card.className = 'rep-opinion-card';

                const typeObj = doc.opinionType || { label: '意見', icon: '💬', color: '#64748b' };
                const attrBadge = doc.attribute ? `<span class="opinion-badge-attr">${escapeHtml(doc.attribute)}</span>` : '';
                const scoreBadge = `<span class="opinion-score-badge">適合度: ${doc.relevanceScore || 50}%</span>`;

                card.innerHTML = `
                    <div class="rep-opinion-header">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span class="rep-rank-badge">★ 代表意見 #${rep.rank}</span>
                            <span class="opinion-type-badge type-${doc.opinionType ? doc.opinionType.type : 'neutral'}">
                                ${typeObj.icon} ${typeObj.label}
                            </span>
                            ${attrBadge}
                        </div>
                        ${scoreBadge}
                    </div>
                    <div class="rep-opinion-text">${formatHighlightedText(doc.text)}</div>
                `;
                repListEl.appendChild(card);
            });
        }
    }

    // 3. 主要論点（トピック別サマリーカード）
    const topicsGridEl = document.getElementById('summaryTopicsGrid');
    if (topicsGridEl) {
        topicsGridEl.innerHTML = '';
        if (!summary.topicSummaries || summary.topicSummaries.length === 0) {
            topicsGridEl.innerHTML = `<div style="color: var(--text-muted); font-size: 13px;">論点グループを分類するのに十分な回答数がありません</div>`;
        } else {
            summary.topicSummaries.forEach(topic => {
                const card = document.createElement('div');
                card.className = 'topic-card';

                const kwTags = topic.keywords.map(kw => `<span class="topic-keyword-tag">${escapeHtml(kw)}</span>`).join('');
                const repText = (topic.representativeOpinions && topic.representativeOpinions.length > 0)
                    ? `「${escapeHtml(topic.representativeOpinions[0].text.length > 75 ? topic.representativeOpinions[0].text.substring(0, 75) + '…' : topic.representativeOpinions[0].text)}」`
                    : '代表意見なし';

                card.innerHTML = `
                    <div>
                        <div class="topic-card-header">
                            <span class="topic-card-title">${escapeHtml(topic.name)}</span>
                            <span class="topic-card-badge">${topic.docCount}件 (${topic.shareRate}%)</span>
                        </div>
                        <div class="topic-keywords-wrap">${kwTags}</div>
                        <div class="topic-rep-text">${repText}</div>
                    </div>
                    <div class="topic-card-footer">
                        <span>💬 クリックして該当の生の声を見る</span>
                        <span>🔍 ドリルダウン</span>
                    </div>
                `;

                // クリックで該当トピックの生の声一覧へジャンプ
                card.addEventListener('click', () => {
                    document.querySelector('.nav-tab-btn[data-tab="opinions"]').click();
                    const primaryKw = topic.keywords[0] || '';
                    document.getElementById('inputFilterOpinionText').value = primaryKw;
                    renderOpinionsList(primaryKw);
                });

                topicsGridEl.appendChild(card);
            });
        }
    }

    // 4. 全体比の特徴キーワード（オッズ比ランキング）
    const oddsTableEl = document.getElementById('summaryOddsKeywordsTable');
    if (oddsTableEl) {
        oddsTableEl.innerHTML = '';
        if (!summary.oddsRatioKeywords || summary.oddsRatioKeywords.length === 0) {
            oddsTableEl.innerHTML = `<div style="color: var(--text-muted); font-size: 13px;">特異度データを計算中、または差分データがありません</div>`;
        } else {
            let trRows = summary.oddsRatioKeywords.map((k, i) => `
                <tr>
                    <td style="font-weight: 700; color: #475569;">#${i + 1}</td>
                    <td><strong>${escapeHtml(k.word)}</strong></td>
                    <td>${k.count} 回 (${k.matchedDf} 件)</td>
                    <td>${k.matchedRatePercent}%</td>
                    <td>${k.totalRatePercent}%</td>
                    <td><span class="odds-ratio-val">約 ${k.oddsRatio} 倍</span></td>
                </tr>
            `).join('');

            oddsTableEl.innerHTML = `
                <table class="odds-table">
                    <thead>
                        <tr>
                            <th style="width: 40px;">順位</th>
                            <th>単語</th>
                            <th>意見内出現数</th>
                            <th>この意見群での出現率</th>
                            <th>アンケート全体での出現率</th>
                            <th>特異度（倍率）</th>
                        </tr>
                    </thead>
                    <tbody>${trRows}</tbody>
                </table>
            `;
        }
    }
}

/**
 * ハイライト付きテキスト整形ヘルパー
 */
function formatHighlightedText(rawText) {
    let highlighted = escapeHtml(rawText);
    const targetLower = (AppState.targetKeyword || '').toLowerCase();
    const resolvedLower = (AppState.resolvedTargetWord || '').toLowerCase();
    const activeRelated = AppState.relatedWords.filter(r => r.checked).map(r => r.word.toLowerCase());

    if (AppState.resolvedTargetWord && AppState.resolvedTargetWord !== AppState.targetKeyword) {
        const regR = new RegExp(escapeRegExp(AppState.resolvedTargetWord), 'gi');
        highlighted = highlighted.replace(regR, m => `<span class="hl-target">${m}</span>`);
    }
    if (AppState.targetKeyword) {
        const regT = new RegExp(escapeRegExp(AppState.targetKeyword), 'gi');
        highlighted = highlighted.replace(regT, m => `<span class="hl-target">${m}</span>`);
    }
    activeRelated.forEach(rw => {
        if (rw) {
            const regRel = new RegExp(escapeRegExp(rw), 'gi');
            highlighted = highlighted.replace(regRel, m => `<span class="hl-related">${m}</span>`);
        }
    });
    return highlighted;
}

/**
 * 生の声（回答文）一覧の描画（ソート・タイプフィルタ・適合度バッジ対応）
 */
function renderOpinionsList(filterKeyword = '') {
    const container = document.getElementById('opinionsListContainer');
    container.innerHTML = '';

    if (!AppState.filterResult || !AppState.filterResult.matchedDocs.length) {
        container.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-muted);">該当する意見がありません</div>`;
        return;
    }

    let docs = [...AppState.filterResult.matchedDocs];
    const filterLower = (filterKeyword || '').toLowerCase().trim();

    // 1. テキスト絞り込み
    if (filterLower) {
        docs = docs.filter(d => d.text.toLowerCase().includes(filterLower));
    }

    // 2. 意見タイプフィルター
    if (AppState.opinionsTypeFilter && AppState.opinionsTypeFilter !== 'all') {
        docs = docs.filter(d => {
            const t = (d.opinionType && d.opinionType.type) ? d.opinionType.type : 'neutral';
            return t === AppState.opinionsTypeFilter;
        });
    }

    // 3. ソート順の適用
    if (AppState.opinionsSort === 'relevance') {
        docs.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
    } else if (AppState.opinionsSort === 'original') {
        docs.sort((a, b) => a.originalIndex - b.originalIndex);
    } else if (AppState.opinionsSort === 'lengthDesc') {
        docs.sort((a, b) => b.text.length - a.text.length);
    }

    if (docs.length === 0) {
        container.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-muted);">指定した条件に該当する意見が見つかりませんでした</div>`;
        return;
    }

    const targetLower = (AppState.targetKeyword || '').toLowerCase();
    const resolvedLower = (AppState.resolvedTargetWord || '').toLowerCase();

    docs.forEach(d => {
        const card = document.createElement('div');
        card.className = 'opinion-card';

        // マッチしたタグ（キーワード、代表語、関連語の色分け）
        const tagsHtml = d.matchedWords.map(w => {
            const wLower = w.toLowerCase();
            const isTarget = wLower === targetLower || wLower === resolvedLower || (targetLower && wLower.includes(targetLower));
            return `<span class="${isTarget ? 'tag-target' : 'tag-related'}">${escapeHtml(w)}</span>`;
        }).join('');

        // 意見タイプバッジ
        const typeObj = d.opinionType || { type: 'neutral', label: 'その他', icon: '⚪' };
        const typeBadge = `<span class="opinion-type-badge type-${typeObj.type}">${typeObj.icon} ${typeObj.label}</span>`;

        // 適合度スコアバッジ
        const scoreBadge = (d.relevanceScore !== undefined)
            ? `<span class="opinion-score-badge">適合度: ${d.relevanceScore}%</span>`
            : '';

        // 属性バッジ
        const attrBadge = d.attribute ? `<span class="opinion-badge-attr">${escapeHtml(d.attribute)}</span>` : '';

        // 文単位抽出の場合、フォーカス案内
        const unitNotice = (AppState.extractUnit === 'sentence' && d.focusedSentences && d.focusedSentences.length > 0)
            ? `<small style="color: #0284c7; font-size: 11px; margin-left: 6px;">[抽出文表示]</small>`
            : '';

        card.innerHTML = `
            <div class="opinion-meta">
                <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                    <div class="opinion-matched-tags">${tagsHtml}</div>
                    ${typeBadge}
                    ${attrBadge}
                    ${unitNotice}
                </div>
                ${scoreBadge}
            </div>
            <div class="opinion-text">${formatHighlightedText(d.text)}</div>
        `;

        container.appendChild(card);
    });
}

/**
 * 全体規模 vs 分析対象（カバレッジ統計）のレンダリング
 */
function renderCoveragePanel(cov) {
    if (!cov) return;
    const panel = document.getElementById('coveragePanel');
    if (!panel) return;
    panel.style.display = 'block';

    // 1. 意見文（回答）
    document.getElementById('covDocMatched').textContent = cov.matched.docCount.toLocaleString();
    document.getElementById('covDocTotal').textContent = cov.total.docCount.toLocaleString();
    document.getElementById('covDocUnmatched').textContent = (cov.total.docCount - cov.matched.docCount).toLocaleString();
    document.getElementById('covDocRateBadge').textContent = `${cov.coverage.docRate.toFixed(1)}%`;
    document.getElementById('covDocProg').style.width = `${Math.min(100, cov.coverage.docRate)}%`;

    // 2. 総単語数
    document.getElementById('covTokenMatched').textContent = cov.matched.totalTokens.toLocaleString();
    document.getElementById('covTokenTotal').textContent = cov.total.totalTokens.toLocaleString();
    document.getElementById('covTokenRateBadge').textContent = `${cov.coverage.tokenRate.toFixed(1)}%`;
    document.getElementById('covTokenProg').style.width = `${Math.min(100, cov.coverage.tokenRate)}%`;
    document.getElementById('covTokenShareText').textContent = `${cov.coverage.tokenRate.toFixed(1)}%`;

    // 3. ユニーク語彙
    document.getElementById('covVocabMatched').textContent = cov.matched.uniqueVocabCount.toLocaleString();
    document.getElementById('covVocabTotal').textContent = cov.total.uniqueVocabCount.toLocaleString();
    document.getElementById('covVocabRateBadge').textContent = `${cov.coverage.vocabRate.toFixed(1)}%`;
    document.getElementById('covVocabProg').style.width = `${Math.min(100, cov.coverage.vocabRate)}%`;
    document.getElementById('covVocabShareText').textContent = `${cov.coverage.vocabRate.toFixed(1)}%`;

    // 4. 文字数
    document.getElementById('covCharMatched').textContent = cov.matched.totalChars.toLocaleString();
    document.getElementById('covCharTotal').textContent = cov.total.totalChars.toLocaleString();
    document.getElementById('covCharRateBadge').textContent = `${cov.coverage.charRate.toFixed(1)}%`;
    document.getElementById('covCharProg').style.width = `${Math.min(100, cov.coverage.charRate)}%`;
    document.getElementById('covCharAvgMatched').textContent = cov.matched.avgCharsPerDoc;
    document.getElementById('covCharAvgTotal').textContent = cov.total.avgCharsPerDoc;

    // 5. 品詞別内訳テーブル
    const tbody = document.getElementById('posDetailTableBody');
    if (tbody) {
        tbody.innerHTML = '';
        const posKeys = ['名詞', '動詞', '形容詞', '副詞'];
        posKeys.forEach(pos => {
            const tot = cov.total.posBreakdown[pos] || 0;
            const mat = cov.matched.posBreakdown[pos] || 0;
            const rate = tot > 0 ? (mat / tot) * 100 : 0;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${pos}</strong></td>
                <td>${tot.toLocaleString()} 語</td>
                <td><strong style="color: var(--primary-color);">${mat.toLocaleString()} 語</strong></td>
                <td>${rate.toFixed(1)}%</td>
                <td>
                    <div class="pos-prog-bar-cell">
                        <div class="pos-prog-inner" style="width: ${Math.min(100, rate)}%;"></div>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }
}

/**
 * 抽出意見のCSVダウンロード
 */
function exportMatchedOpinionsCsv() {
    if (!AppState.filterResult || !AppState.filterResult.matchedDocs.length) {
        alert('ダウンロード可能な意見がありません。');
        return;
    }

    const data = AppState.filterResult.matchedDocs.map((d, i) => ({
        No: i + 1,
        属性: d.attribute || '',
        意見テキスト: d.text,
        マッチ単語: d.matchedWords.join(', ')
    }));

    const csvStr = Papa.unparse(data);
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvStr], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `matched_opinions_${AppState.targetKeyword}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * 各図の画像エクスポート（ダウンロード または クリップボードコピー）
 * WordやPowerPointで利用することを想定し、純白（#ffffff）の背景で合成出力する
 * @param {'cloud' | 'network' | 'umap' | 'attr'} type
 * @param {'download' | 'copy'} action
 */
async function exportChart(type, action = 'download') {
    const kw = (AppState.targetKeyword || '全体').replace(/[\\/:*?"<>|]/g, '_');
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    const titles = {
        cloud: `ワードクラウド_${kw}_${dateStr}`,
        network: `共起ネットワーク_${kw}_${dateStr}`,
        umap: `UMAP散布図_${kw}_${dateStr}`,
        attr: `属性別クロス集計_${kw}_${dateStr}`
    };
    const baseTitle = titles[type] || `分析図_${kw}_${dateStr}`;

    // 1. 属性別集計（Plotly グラフ）
    if (type === 'attr') {
        if (typeof Plotly === 'undefined') {
            showToast('⚠️ グラフ描画ライブラリが準備できていません');
            return;
        }
        const container = document.getElementById('attrChartContainer');
        if (!container || !container.data || container.data.length === 0) {
            showToast('⚠️ 保存可能な属性グラフがありません');
            return;
        }

        // 資料・スライドで扱いやすい 4:3 比率 (1200x900) で最大化出力
        const targetW = 1200;
        const targetH = 900;

        if (action === 'download') {
            Plotly.downloadImage('attrChartContainer', {
                format: 'png',
                width: targetW,
                height: targetH,
                filename: baseTitle
            });
            showToast(`💾「${baseTitle}.png」(4:3・1200x900) を保存しました`);
        } else {
            // クリップボードへコピー
            try {
                const dataUrl = await Plotly.toImage('attrChartContainer', {
                    format: 'png',
                    width: targetW,
                    height: targetH
                });
                const res = await fetch(dataUrl);
                const blob = await res.blob();
                if (navigator.clipboard && window.ClipboardItem) {
                    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                    showToast('📋 属性グラフ(4:3・1200x900)をクリップボードにコピーしました！\nWordやPowerPointに [Ctrl+V] で直接貼り付けできます。');
                } else {
                    showToast('⚠️ お使いのブラウザは画像の直接コピーに非対応です。画像保存をご利用ください。');
                }
            } catch (err) {
                console.error('Plotly copy error:', err);
                showToast('⚠️ クリップボードへの画像コピーに失敗しました');
            }
        }
        return;
    }

    // 2. Canvas 系の図（ワードクラウド, 共起ネットワーク, UMAP）
    // 資料向け標準サイズ: 4:3 比率 (1200x900) で、領域いっぱいに自動拡大調整
    const targetW = 1200;
    const targetH = 900;
    let exportCanvas = null;

    if (type === 'network' && typeof NetworkVisualizer.getExportCanvas === 'function') {
        exportCanvas = NetworkVisualizer.getExportCanvas(targetW, targetH);
    } else if (type === 'umap' && typeof UmapVisualizer.getExportCanvas === 'function') {
        exportCanvas = UmapVisualizer.getExportCanvas(targetW, targetH);
    } else if (type === 'cloud' && typeof WordCloudVisualizer.getExportCanvas === 'function') {
        exportCanvas = await WordCloudVisualizer.getExportCanvas(targetW, targetH);
    }

    // フォールバック: getExportCanvas で取得できなかった場合
    if (!exportCanvas) {
        let srcCanvas = null;
        if (type === 'cloud') srcCanvas = document.getElementById('cloudCanvas');
        else if (type === 'network') srcCanvas = document.getElementById('networkCanvas');
        else if (type === 'umap') srcCanvas = document.getElementById('umapCanvas');

        if (!srcCanvas || srcCanvas.width === 0 || srcCanvas.height === 0) {
            showToast('⚠️ 保存可能な図が表示されていません');
            return;
        }

        // 白背景キャンバスに中央フィット合成
        exportCanvas = document.createElement('canvas');
        exportCanvas.width = targetW;
        exportCanvas.height = targetH;
        const ctx = exportCanvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, targetW, targetH);

        const scale = Math.min((targetW - 40) / srcCanvas.width, (targetH - 40) / srcCanvas.height);
        const drawW = srcCanvas.width * scale;
        const drawH = srcCanvas.height * scale;
        const drawX = (targetW - drawW) / 2;
        const drawY = (targetH - drawH) / 2;
        ctx.drawImage(srcCanvas, drawX, drawY, drawW, drawH);
    }

    if (action === 'download') {
        const filename = `${baseTitle}.png`;
        const url = exportCanvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showToast(`💾「${filename}」(4:3・1200x900・最大調整済) を保存しました`);
    } else {
        // クリップボードへコピー
        if (!navigator.clipboard || !window.ClipboardItem) {
            showToast('⚠️ お使いのブラウザは画像の直接コピーに対応していません。画像保存をご利用ください。');
            return;
        }
        exportCanvas.toBlob(async (blob) => {
            if (!blob) {
                showToast('⚠️ 画像の生成に失敗しました');
                return;
            }
            try {
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                showToast(`📋「${baseTitle}」(4:3・1200x900・最大調整済) をクリップボードにコピーしました！\nWordやPowerPointに [Ctrl+V] で直接貼り付けできます。`);
            } catch (err) {
                console.warn('Clipboard write error:', err);
                showToast('⚠️ クリップボードへの画像コピーに失敗しました。画像保存をご利用ください。');
            }
        }, 'image/png');
    }
}

/**
 * 互換性のための関数
 */
function saveCurrentImage() {
    exportChart(AppState.activeTab, 'download');
}

/**
 * トースト通知を表示
 * @param {string} message
 */
function showToast(message) {
    let toast = document.getElementById('appToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'appToast';
        toast.className = 'toast-notification';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.remove('hide');
    toast.style.display = 'flex';
    if (toast._timer) clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
        toast.classList.add('hide');
        setTimeout(() => { toast.style.display = 'none'; }, 300);
    }, 4000);
}

/**
 * 辞書設定モーダルのセットアップ
 */
function setupDictModalEvents() {
    const modal = document.getElementById('dictModal');
    const btnOpen = document.getElementById('btnOpenDict');
    const btnClose = document.getElementById('btnCloseDictModal');
    const btnCancel = document.getElementById('btnCancelDict');
    const btnSave = document.getElementById('btnSaveDict');

    btnOpen.addEventListener('click', () => {
        // 現在の辞書を設定欄に反映
        document.getElementById('textCustomStopwords').value = Array.from(TextPreprocessor.customStopWords).join('\n');
        
        const synLines = [];
        TextPreprocessor.customSynonymRules.forEach((rep, src) => {
            synLines.push(`${src}=${rep}`);
        });
        document.getElementById('textCustomSynonyms').value = synLines.join('\n');

        document.getElementById('textCustomCompounds').value = Array.from(TextPreprocessor.customCompoundWords).join('\n');

        modal.style.display = 'flex';
    });

    [btnClose, btnCancel].forEach(btn => {
        btn.addEventListener('click', () => { modal.style.display = 'none'; });
    });

    btnSave.addEventListener('click', () => {
        const stopText = document.getElementById('textCustomStopwords').value;
        const synText = document.getElementById('textCustomSynonyms').value;
        const compText = document.getElementById('textCustomCompounds').value;

        TextPreprocessor.customStopWords.clear();
        stopText.split(/[\n,]/).forEach(w => {
            const tr = w.trim();
            if (tr) TextPreprocessor.customStopWords.add(tr);
        });

        TextPreprocessor.customSynonymRules.clear();
        synText.split('\n').forEach(line => {
            const parts = line.split('=');
            if (parts.length >= 2) {
                TextPreprocessor.customSynonymRules.set(parts[0].trim(), parts[1].trim());
            }
        });

        TextPreprocessor.customCompoundWords.clear();
        compText.split('\n').forEach(w => {
            const tr = w.trim();
            if (tr) TextPreprocessor.customCompoundWords.add(tr);
        });

        modal.style.display = 'none';
        AppState.isTokenized = false; // 再トークン化して再分析
        runFocusAnalysis();
    });
}

function escapeHtml(str) {
    return (str || '').replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
}

function escapeRegExp(str) {
    return (str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
