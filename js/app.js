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
    
    // 解析フィルター設定
    filterOptions: {
        posNoun: true,
        posVerb: true,
        posAdj: true,
        posAdv: false,
        posIntj: false,
        mergeCompoundNouns: true,
        useDefaultStopwords: true
    },
    // カスタム辞書・除外語・表記ゆれルール
    customStopWords: new Set(),
    customCompoundWords: new Set(),
    customSynonymRules: new Map(),
    totalCorpusStats: null, // 全体規模統計（文数・文字数・総単語数・語彙数・品詞別）
    coverageStats: null,    // 全体 vs 対象のカバレッジ比較統計
    
    // 抽出条件設定
    matchMode: 'or',       // 'or' | 'and'
    extractUnit: 'doc',    // 'doc' | 'sentence'
    
    // 要約・集約データ
    summaryData: null,

    // データプレビュー・取捨選択・列フィルター
    previewMode: 'limit', // 'limit' (先頭5行) または 'all' (全行表示)
    previewPage: 1,
    previewPageSize: 50,
    previewFilterWarning: false, // true: 問題のある行のみ絞り込み
    selectedRowIndices: new Set(), // 選択された行インデックス（一括削除用）
    columnFilters: {}, // 列ごとのフィルター条件 { 列名: [値1, 値2...] }

    // UI状態
    activeTab: 'summary', // 初期タブを要約サマリーに
    opinionsSort: 'relevance', // 'relevance' | 'original' | 'lengthDesc'
    opinionsTypeFilter: 'all', // 'all' | 'issue' | 'request' | 'positive' | 'neutral'
    cloudRanking: 'count',
    cloudMaxWords: 60,
    cloudShape: 'circle',
    networkMaxWords: 40,
    networkSpacing: 'wide',
    networkFontSize: 'large',
    networkColorMode: 'community',
    canvasSizeMode: 'standard', // 'compact' | 'standard' | 'large' | 'fullscreen'
    isFocusMode: false,         // 上部入力・設定パネルの折りたたみ集中表示状態
    umapMode: 'words',
    umapClustering: 'hdbscan',
    umapMinClusterSize: 'auto',
    umapSpread: 'wide',
    umapFontSize: 'large'
};

document.addEventListener('DOMContentLoaded', async () => {
    // 1. 各ビジュアライザーの初期化
    WordCloudVisualizer.init('cloudCanvas');
    NetworkVisualizer.init('networkCanvas');
    UmapVisualizer.init('umapCanvas');
    AttrChartVisualizer.init('attrChartContainer');

    // 2. カスタムルールの復元
    loadCustomRulesFromStorage();

    // 3. UIイベントリスナーの登録（即座に操作可能にする）
    setupUIEvents();

    // 4. Kuromoji 形態素解析器の非同期事前準備（バックグラウンドでロード）
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
        renderPreviewTable();
        if (AppState.targetKeyword) {
            runFocusAnalysis();
        }
    });

    document.getElementById('selectAttrCol').addEventListener('change', (e) => {
        AppState.attrCol = e.target.value;
        renderPreviewTable();
        if (AppState.targetKeyword && AppState.filterResult) {
            updateVisualizations();
        }
    });

    // データプレビュー操作コントロール
    const btnPreviewLimit = document.getElementById('btnPreviewLimit');
    const btnPreviewAll = document.getElementById('btnPreviewAll');
    const btnFilterWarnings = document.getElementById('btnFilterWarnings');
    const btnAddRow = document.getElementById('btnAddRow');
    const btnBulkDelete = document.getElementById('btnBulkDelete');
    const btnPrevPage = document.getElementById('btnPrevPage');
    const btnNextPage = document.getElementById('btnNextPage');
    const btnClearAllFilters = document.getElementById('btnClearAllFilters');
    const previewTableThead = document.getElementById('previewTableThead');
    const previewTableTbody = document.getElementById('previewTableTbody');

    if (btnPreviewLimit) {
        btnPreviewLimit.addEventListener('click', () => {
            AppState.previewMode = 'limit';
            btnPreviewLimit.classList.add('active');
            if (btnPreviewAll) btnPreviewAll.classList.remove('active');
            renderPreviewTable();
        });
    }

    if (btnPreviewAll) {
        btnPreviewAll.addEventListener('click', () => {
            AppState.previewMode = 'all';
            btnPreviewAll.classList.add('active');
            if (btnPreviewLimit) btnPreviewLimit.classList.remove('active');
            renderPreviewTable();
        });
    }

    if (btnFilterWarnings) {
        btnFilterWarnings.addEventListener('click', () => {
            AppState.previewFilterWarning = !AppState.previewFilterWarning;
            btnFilterWarnings.classList.toggle('active', AppState.previewFilterWarning);
            AppState.previewPage = 1;
            renderPreviewTable();
        });
    }

    if (btnAddRow) {
        btnAddRow.addEventListener('click', () => {
            addNewRow();
        });
    }

    if (btnBulkDelete) {
        btnBulkDelete.addEventListener('click', () => {
            deleteSelectedRows();
        });
    }

    if (btnPrevPage) {
        btnPrevPage.addEventListener('click', () => {
            if (AppState.previewPage > 1) {
                AppState.previewPage--;
                renderPreviewTable();
            }
        });
    }

    if (btnNextPage) {
        btnNextPage.addEventListener('click', () => {
            AppState.previewPage++;
            renderPreviewTable();
        });
    }

    if (btnClearAllFilters) {
        btnClearAllFilters.addEventListener('click', () => {
            clearAllColumnFilters();
        });
    }

    // テーブルヘッダーの全選択チェックボックスイベント
    if (previewTableThead) {
        previewTableThead.addEventListener('change', (e) => {
            if (e.target && e.target.id === 'checkSelectAll') {
                const checked = e.target.checked;
                const checkboxes = previewTableTbody.querySelectorAll('.row-checkbox');
                checkboxes.forEach(cb => {
                    cb.checked = checked;
                    const idx = parseInt(cb.getAttribute('data-row-idx'), 10);
                    if (checked) {
                        AppState.selectedRowIndices.add(idx);
                    } else {
                        AppState.selectedRowIndices.delete(idx);
                    }
                    const tr = document.getElementById(`previewRow_${idx}`);
                    if (tr) {
                        if (checked) tr.classList.add('row-selected');
                        else tr.classList.remove('row-selected');
                    }
                });
                updateBulkDeleteBtn();
            }
        });
    }

    // テーブルボディの行チェックボックス・編集・削除イベント（委譲）
    if (previewTableTbody) {
        // 行チェックボックス
        previewTableTbody.addEventListener('change', (e) => {
            if (e.target && e.target.classList.contains('row-checkbox')) {
                const rowIdx = parseInt(e.target.getAttribute('data-row-idx'), 10);
                if (e.target.checked) {
                    AppState.selectedRowIndices.add(rowIdx);
                } else {
                    AppState.selectedRowIndices.delete(rowIdx);
                }
                const tr = document.getElementById(`previewRow_${rowIdx}`);
                if (tr) {
                    if (e.target.checked) tr.classList.add('row-selected');
                    else tr.classList.remove('row-selected');
                }
                updateBulkDeleteBtn();
                updateSelectAllState();
            }
        });

        // セル編集完了（フォーカスが外れた時）
        previewTableTbody.addEventListener('focusout', (e) => {
            if (e.target && e.target.classList.contains('cell-editable')) {
                const rowIdx = parseInt(e.target.getAttribute('data-row-idx'), 10);
                const col = e.target.getAttribute('data-col');
                const newVal = e.target.innerText.trim();

                if (AppState.rawRows[rowIdx]) {
                    AppState.rawRows[rowIdx][col] = newVal;
                    AppState.isTokenized = false; // データ更新時は再トークン化フラグ
                    updateRowAndAlertsAfterEdit(rowIdx);
                    updateFocusRunButtons();
                }
            }
        });

        // セル内で Enter キーが押されたら確定してフォーカスを外す (Shift+Enterは改行許容)
        previewTableTbody.addEventListener('keydown', (e) => {
            if (e.target && e.target.classList.contains('cell-editable')) {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    e.target.blur();
                }
            }
        });

        // 個別行削除ボタン
        previewTableTbody.addEventListener('click', (e) => {
            const delBtn = e.target.closest('.btn-row-del');
            if (delBtn) {
                const rowIdx = parseInt(delBtn.getAttribute('data-row-idx'), 10);
                deleteRow(rowIdx);
            }
        });
    }

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
    const selectCloudShape = document.getElementById('selectCloudShape');
    if (selectCloudShape) {
        selectCloudShape.addEventListener('change', (e) => {
            AppState.cloudShape = e.target.value;
            updateWordCloud();
        });
    }
    const inputCloudMaxWords = document.getElementById('inputCloudMaxWords');
    if (inputCloudMaxWords) {
        const handleMaxWordsChange = () => {
            let val = parseInt(inputCloudMaxWords.value, 10);
            if (isNaN(val) || val < 5) val = 60;
            if (val > 300) val = 300;
            if (AppState.cloudMaxWords !== val) {
                AppState.cloudMaxWords = val;
                updateWordCloud();
            }
        };
        inputCloudMaxWords.addEventListener('change', handleMaxWordsChange);
    }
    const oldSelectCloudMaxWords = document.getElementById('selectCloudMaxWords');
    if (oldSelectCloudMaxWords && oldSelectCloudMaxWords !== inputCloudMaxWords) {
        oldSelectCloudMaxWords.addEventListener('change', (e) => {
            AppState.cloudMaxWords = parseInt(e.target.value, 10) || 60;
            updateWordCloud();
        });
    }

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
    const selectNetColorMode = document.getElementById('selectNetworkColorMode');
    if (selectNetColorMode) {
        selectNetColorMode.addEventListener('change', (e) => {
            AppState.networkColorMode = e.target.value;
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
    const selectUmapClustering = document.getElementById('selectUmapClustering');
    const selectUmapMinClusterSize = document.getElementById('selectUmapMinClusterSize');
    const labelUmapMinClusterSize = document.getElementById('labelUmapMinClusterSize');
    if (selectUmapClustering) {
        selectUmapClustering.addEventListener('change', (e) => {
            AppState.umapClustering = e.target.value;
            if (labelUmapMinClusterSize) {
                labelUmapMinClusterSize.style.display = e.target.value === 'hdbscan' ? 'inline-block' : 'none';
            }
            updateUmap();
        });
    }
    if (selectUmapMinClusterSize) {
        selectUmapMinClusterSize.addEventListener('change', (e) => {
            AppState.umapMinClusterSize = e.target.value;
            updateUmap();
        });
    }
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

    // 表示サイズ切り替えボタン群（ノートPCなど画面サイズ向け）
    document.querySelectorAll('.view-size-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const size = btn.dataset.size;
            setCanvasSizeMode(size);
        });
    });

    // 全画面トグルボタン
    const btnFullscreen = document.getElementById('btnToggleFullscreen');
    if (btnFullscreen) {
        btnFullscreen.addEventListener('click', () => {
            const nextMode = AppState.canvasSizeMode === 'fullscreen' ? 'standard' : 'fullscreen';
            setCanvasSizeMode(nextMode);
        });
    }

    // 全画面終了ボタン（キャンバス内の✕ボタン）
    document.querySelectorAll('.btn-exit-fullscreen').forEach(btn => {
        btn.addEventListener('click', () => {
            setCanvasSizeMode('standard');
        });
    });

    // Escキーでの全画面解除
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && AppState.canvasSizeMode === 'fullscreen') {
            setCanvasSizeMode('standard');
        }
    });

    // 集中分析モード（上部パネル折りたたみ）トグル
    const btnFocus = document.getElementById('btnToggleFocusMode');
    if (btnFocus) {
        btnFocus.addEventListener('click', () => toggleFocusMode());
    }
    const btnExitFocus = document.getElementById('btnExitFocusMode');
    if (btnExitFocus) {
        btnExitFocus.addEventListener('click', () => toggleFocusMode(false));
    }

    // ウィンドウリサイズ時の自動フィット再描画（デバウンス）
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            if (AppState.filterResult) {
                updateVisualizations();
            }
        }, 150);
    });

    // STEP 2: 抽出品詞および辞書設定イベントの登録
    setupPosEvents();
    setupDictionaryEvents();

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

    // ヘッダーの辞書設定ボタン（STEP 2 の辞書セクションへスクロール＆展開）
    const btnOpenDict = document.getElementById('btnOpenDict');
    if (btnOpenDict) {
        btnOpenDict.addEventListener('click', () => {
            const prepSection = document.getElementById('prepSection');
            const dictSection = document.getElementById('dictionarySection');
            const dictBody = document.getElementById('dictionaryBody');
            if (prepSection) prepSection.style.display = 'block';
            if (dictSection && dictBody) {
                dictSection.classList.add('is-open');
                dictBody.style.display = 'block';
                dictSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });
    }

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

    // 初期表示サイズモードの適用 (保存・Officeコピー仕様と同じ4:3比率)
    setCanvasSizeMode('standard');
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
    AppState.previewMode = 'limit';
    AppState.previewPage = 1;
    AppState.previewFilterWarning = false;
    AppState.selectedRowIndices = new Set();
    AppState.columnFilters = {};

    const btnPreviewLimit = document.getElementById('btnPreviewLimit');
    const btnPreviewAll = document.getElementById('btnPreviewAll');
    const btnFilterWarnings = document.getElementById('btnFilterWarnings');
    if (btnPreviewLimit) btnPreviewLimit.classList.add('active');
    if (btnPreviewAll) btnPreviewAll.classList.remove('active');
    if (btnFilterWarnings) btnFilterWarnings.classList.remove('active');

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

    // 列の自動推測（自由記述・発言内容列 / 属性・立場列）
    let guessedText = AppState.headers[0];
    const textKeywordCandidates = ['自由記述', '発言内容', '発言', '意見', 'コメント', '本文', 'テキスト', '回答'];
    const matchedTextHeader = AppState.headers.find(h => textKeywordCandidates.some(k => h.includes(k)));

    if (matchedTextHeader) {
        guessedText = matchedTextHeader;
    } else {
        let maxAvgLen = 0;
        AppState.headers.forEach(h => {
            const lens = AppState.rawRows.slice(0, 30).map(r => String(r[h] || '').length);
            const avg = lens.reduce((a, b) => a + b, 0) / (lens.length || 1);
            if (avg > maxAvgLen) {
                maxAvgLen = avg;
                guessedText = h;
            }
        });
    }
    textSelect.value = guessedText;
    AppState.textCol = guessedText;

    // 属性列の推測（座談会の発言者・立場・所属、アンケートの年代・性別・満足度など）
    const attrCandidates = [
        '発言者', '出席者', '参加者', '立場', '役職', '所属', '区分', '属性',
        '年代', '年齢', '性別', 'カテゴリ', '満足度', '地域', '部門', 'グループ'
    ];
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

    // 設定パネル・STEP 2（解析・辞書設定）・STEP 3（キーワードセクション）を表示
    const configGrid = document.getElementById('configGrid');
    const prepSection = document.getElementById('prepSection');
    const focusSection = document.getElementById('focusSection');
    if (configGrid) configGrid.style.display = 'block';
    if (prepSection) prepSection.style.display = 'block';
    if (focusSection) focusSection.style.display = 'block';

    // 辞書UIおよび頻出キーワード候補の描画
    renderCustomRulesUI();
    renderFrequentKeywordsSuggest();

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
            chipsContainer.innerHTML = '<span style="color: var(--text-muted); font-size: 13px;">注目したいキーワードを入力（または候補をクリック）して「🚀 関連語を探索 ＆ 分析スタート」をクリックしてください</span>';
        }
    }
}

/**
 * 行データが指定の列フィルター条件に合致するか判定
 * @param {Object} row 
 * @param {string} col 
 * @param {string|string[]} filterVal 
 * @returns {boolean}
 */
function isRowMatchFilter(row, col, filterVal) {
    if (filterVal === undefined || filterVal === null || filterVal === '') return true;
    const rawVal = row[col];
    const strVal = (rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== '') ? String(rawVal).trim() : '（未設定）';
    if (Array.isArray(filterVal)) {
        if (filterVal.length === 0) return false;
        return filterVal.includes(strVal);
    }
    return strVal === String(filterVal).trim();
}

/**
 * 現在の列フィルターを適用し、かつ分析対象（自由記述）が有効な行一覧を取得
 * （分析対象列が空欄あるいは記号・定型無効回答の行は自動的に除外）
 */
function getFilteredRows() {
    const activeFilters = Object.entries(AppState.columnFilters).filter(([_, v]) => {
        if (Array.isArray(v)) return v.length > 0;
        return v !== undefined && v !== null && v !== '';
    });

    return AppState.rawRows.filter(r => {
        // 1. 各列のオートフィルター条件を満たすか判定
        const matchColFilters = activeFilters.every(([col, val]) => isRowMatchFilter(r, col, val));
        if (!matchColFilters) return false;

        // 2. 分析対象列（自由記述列）が空欄・記号等の無効回答の行は自動的に除外
        if (AppState.textCol) {
            const rawText = r[AppState.textCol];
            const textStr = (rawText !== undefined && rawText !== null) ? String(rawText).trim() : '';
            if (TextPreprocessor.isJunkResponse(textStr)) {
                return false;
            }
        }

        return true;
    });
}

/**
 * 列フィルターを設定
 * @param {string} col 
 * @param {string|string[]|null} val 
 */
function setColumnFilter(col, val) {
    if (val === undefined || val === null || val === '') {
        delete AppState.columnFilters[col];
    } else if (Array.isArray(val)) {
        if (val.length === 0) {
            delete AppState.columnFilters[col];
        } else {
            AppState.columnFilters[col] = [...val];
        }
    } else {
        AppState.columnFilters[col] = [String(val).trim()];
    }
    AppState.previewPage = 1;
    AppState.isTokenized = false; // フィルター変更時は再トークン化
    renderPreviewTable();
    updateFocusRunButtons();
}

/**
 * すべての列フィルターを解除
 */
function clearAllColumnFilters() {
    AppState.columnFilters = {};
    AppState.previewPage = 1;
    AppState.isTokenized = false;
    renderPreviewTable();
    updateFocusRunButtons();
}

/**
 * 分析実行ボタンの表記・ヒントを更新
 */
function updateFocusRunButtons() {
    const btnRun = document.getElementById('btnRunFocus');
    const runHint = document.getElementById('focusRunHint');
    const filteredRows = getFilteredRows();
    const activeFilters = Object.entries(AppState.columnFilters).filter(([_, v]) => {
        if (Array.isArray(v)) return v.length > 0;
        return v !== undefined && v !== null && v !== '';
    });
    const isFiltered = activeFilters.length > 0;
    const filterDesc = activeFilters.map(([c, v]) => {
        const vStr = Array.isArray(v) ? (v.length <= 2 ? v.join(', ') : `${v.slice(0, 2).join(', ')} ほか${v.length}件`) : v;
        return `${c}＝${vStr}`;
    }).join('; ');

    const totalRaw = AppState.rawRows.length;
    const hasExcluded = filteredRows.length < totalRaw;

    if (btnRun) {
        if (isFiltered) {
            btnRun.innerHTML = `🚀 絞り込んだ ${filteredRows.length}件 で分析`;
            if (runHint) runHint.innerHTML = `※ 絞り込み条件（<b>${escapeHtml(filterDesc)}</b>）に合致した有効な <b>${filteredRows.length}件</b> を対象に分析します`;
        } else if (hasExcluded) {
            btnRun.innerHTML = `🚀 有効な ${filteredRows.length}件 で分析`;
            if (runHint) runHint.innerHTML = `※ 空欄・定型無効等のノイズを除外した有効な <b>${filteredRows.length}件</b>（全${totalRaw}件中）を対象に分析します`;
        } else {
            btnRun.innerHTML = `🚀 関連語を探索 ＆ 分析`;
            if (runHint) runHint.textContent = `※ 全 ${totalRaw} 件の有効データを対象に分析します`;
        }
    }
}

/**
 * 適用中フィルターバー（#activeFiltersBar）のUI更新
 */
function updateActiveFiltersBar() {
    const bar = document.getElementById('activeFiltersBar');
    const list = document.getElementById('activeFiltersList');
    const countInfo = document.getElementById('activeFiltersCountInfo');
    if (!bar || !list) return;

    const activeEntries = Object.entries(AppState.columnFilters).filter(([_, v]) => {
        if (Array.isArray(v)) return v.length > 0;
        return v !== undefined && v !== null && v !== '';
    });
    if (activeEntries.length === 0) {
        bar.style.display = 'none';
        list.innerHTML = '';
        return;
    }

    bar.style.display = 'flex';
    list.innerHTML = '';

    activeEntries.forEach(([col, val]) => {
        const tag = document.createElement('span');
        tag.className = 'filter-tag';
        let valDisplay = '';
        if (Array.isArray(val)) {
            if (val.length === 1) {
                valDisplay = val[0];
            } else if (val.length <= 2) {
                valDisplay = val.join(', ');
            } else {
                valDisplay = `${val.slice(0, 2).join(', ')} ほか計${val.length}件`;
            }
        } else {
            valDisplay = String(val);
        }
        tag.innerHTML = `
            <span>${escapeHtml(col)}: <b>${escapeHtml(valDisplay)}</b></span>
            <button type="button" class="filter-tag-del" title="${escapeHtml(col)}のフィルターを解除" data-col="${escapeHtml(col)}">&times;</button>
        `;
        tag.querySelector('.filter-tag-del').addEventListener('click', () => {
            setColumnFilter(col, null);
        });
        list.appendChild(tag);
    });

    const filteredRows = getFilteredRows();
    if (countInfo) {
        countInfo.textContent = `全 ${AppState.rawRows.length}件中 ${filteredRows.length}件 に絞り込み中`;
    }
}

/**
 * 属性値のインテリジェント自然順ソート（評価尺度・数値・未設定対応）
 */
function sortAttributeValues(attrList) {
    const ORDER_MAP = {
        '非常に良くなっている': 1, 'かなり良くなっている': 1, '大きく改善': 1, '大いに改善': 1,
        '良くなっている': 2, '改善している': 2, '改善した': 2, '良くなった': 2,
        'やや良くなっている': 3, '少し良くなっている': 3, 'やや改善している': 3, 'やや改善': 3, '少し改善': 3,
        '変わらない': 4, '変化なし': 4, 'どちらともいえない': 4, '普通': 4, '同等': 4, '同じ': 4,
        'やや悪くなっている': 5, '少し悪くなっている': 5, 'やや悪化している': 5, 'やや悪化': 5, '少し悪化': 5,
        '悪くなっている': 6, '悪化している': 6, '悪化した': 6, '悪くなった': 6,
        '非常に悪くなっている': 7, 'かなり悪くなっている': 7, '大きく悪化': 7,
        '大変満足': 1, '非常に満足': 1, 'とても満足': 1,
        '満足': 2,
        'やや満足': 3, '少し満足': 3,
        'やや不満': 5, '少し不満': 5,
        '不満': 6,
        '大変不満': 7, '非常に不満': 7, 'とても不満': 7,
        '大変良い': 1, '非常に良い': 1, 'とても良い': 1,
        '良い': 2,
        'やや良い': 3, '少し良い': 3,
        'やや悪い': 5, '少し悪い': 5,
        '悪い': 6,
        '大変悪い': 7, '非常に悪い': 7, 'とても悪い': 7,
        '高': 1, '高い': 1, '中': 2, '低': 3, '低い': 3,
        '大': 1, '小': 3,
        '多い': 1, '少ない': 3,
        '頻繁に': 1, '時々': 2, 'たまに': 3, 'ほとんどない': 4, '全くない': 5
    };

    const getLeadingNumber = (str) => {
        if (!str) return null;
        const firstCharCode = str.charCodeAt(0);
        if (firstCharCode >= 0x2460 && firstCharCode <= 0x2473) {
            return firstCharCode - 0x2460 + 1;
        }
        const halfStr = str.replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
        const match = halfStr.match(/^[\(\[\{【]?(\d+)[\)\]\}】._\s、。\-\:]*/);
        if (match) return parseInt(match[1], 10);
        return null;
    };

    return Array.from(attrList).sort((a, b) => {
        const strA = String(a !== undefined && a !== null ? a : '').trim();
        const strB = String(b !== undefined && b !== null ? b : '').trim();

        if (strA === '（未設定）' || strA === '') return 1;
        if (strB === '（未設定）' || strB === '') return -1;

        const leadA = getLeadingNumber(strA);
        const leadB = getLeadingNumber(strB);
        if (leadA !== null && leadB !== null && leadA !== leadB) {
            return leadA - leadB;
        }

        const rankA = ORDER_MAP[strA];
        const rankB = ORDER_MAP[strB];
        if (rankA !== undefined && rankB !== undefined && rankA !== rankB) {
            return rankA - rankB;
        }

        const halfA = strA.replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
        const halfB = strB.replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
        const numA = (halfA.match(/\d+/) || [])[0];
        const numB = (halfB.match(/\d+/) || [])[0];
        if (numA !== undefined && numB !== undefined && numA !== numB) {
            return parseInt(numA, 10) - parseInt(numB, 10);
        }

        return strA.localeCompare(strB, 'ja');
    });
}

/**
 * Excel風ヘッダーフィルターメニューの表示（チェックボックス複数選択対応）
 */
function showColumnFilterMenu(triggerBtn, colName) {
    let menu = document.getElementById('excelFilterMenu');
    if (!menu) {
        menu = document.createElement('div');
        menu.id = 'excelFilterMenu';
        menu.className = 'excel-filter-menu';
        document.body.appendChild(menu);

        document.addEventListener('click', (e) => {
            if (!menu.contains(e.target) && !e.target.closest('.btn-th-filter')) {
                menu.style.display = 'none';
            }
        });
    }

    if (menu.style.display === 'flex' && menu.getAttribute('data-target-col') === colName) {
        menu.style.display = 'none';
        return;
    }

    menu.setAttribute('data-target-col', colName);
    menu.innerHTML = '';

    const headerEl = document.createElement('div');
    headerEl.className = 'excel-filter-menu-header';
    headerEl.innerHTML = `
        <span class="excel-filter-menu-title">【${escapeHtml(colName)}】で絞り込み</span>
        <button type="button" class="excel-filter-menu-close" title="閉じる">&times;</button>
    `;
    headerEl.querySelector('.excel-filter-menu-close').addEventListener('click', () => {
        menu.style.display = 'none';
    });
    menu.appendChild(headerEl);

    // 他の列フィルターを考慮した候補集計
    const otherFilters = { ...AppState.columnFilters };
    delete otherFilters[colName];
    const otherFilteredRows = AppState.rawRows.filter(r => {
        return Object.entries(otherFilters).every(([c, v]) => isRowMatchFilter(r, c, v));
    });

    const valCounts = {};
    otherFilteredRows.forEach(r => {
        const raw = r[colName];
        const val = (raw !== undefined && raw !== null && String(raw).trim() !== '') ? String(raw).trim() : '（未設定）';
        valCounts[val] = (valCounts[val] || 0) + 1;
    });

    const sortedVals = sortAttributeValues(Object.keys(valCounts));

    const currentFilter = AppState.columnFilters[colName];
    let selectedSet;
    if (!currentFilter || (Array.isArray(currentFilter) && currentFilter.length === 0)) {
        selectedSet = new Set(sortedVals);
    } else if (Array.isArray(currentFilter)) {
        selectedSet = new Set(currentFilter);
    } else {
        selectedSet = new Set([String(currentFilter).trim()]);
    }

    const actionsEl = document.createElement('div');
    actionsEl.className = 'excel-filter-actions';
    actionsEl.innerHTML = `
        <button type="button" class="btn-filter-action" id="btnFilterSelectAll">全選択</button>
        <button type="button" class="btn-filter-action" id="btnFilterClearAll">全解除</button>
    `;
    menu.appendChild(actionsEl);

    const listEl = document.createElement('div');
    listEl.className = 'excel-filter-list';

    const itemAll = document.createElement('label');
    itemAll.className = 'excel-filter-item';
    const chkAll = document.createElement('input');
    chkAll.type = 'checkbox';
    chkAll.className = 'excel-filter-checkbox';
    itemAll.appendChild(chkAll);

    const lblAll = document.createElement('span');
    lblAll.className = 'excel-filter-label';
    lblAll.innerHTML = '<b>(すべて選択)</b>';
    itemAll.appendChild(lblAll);

    const countAll = document.createElement('span');
    countAll.className = 'excel-filter-item-count';
    countAll.textContent = `${otherFilteredRows.length}件`;
    itemAll.appendChild(countAll);

    listEl.appendChild(itemAll);

    const divider = document.createElement('div');
    divider.className = 'excel-filter-divider';
    listEl.appendChild(divider);

    const itemCheckboxes = [];
    sortedVals.forEach(val => {
        const item = document.createElement('label');
        item.className = 'excel-filter-item';

        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.className = 'excel-filter-checkbox';
        chk.value = val;
        chk.checked = selectedSet.has(val);
        item.appendChild(chk);

        const lbl = document.createElement('span');
        lbl.className = 'excel-filter-label';
        lbl.textContent = val;
        item.appendChild(lbl);

        const countSpan = document.createElement('span');
        countSpan.className = 'excel-filter-item-count';
        countSpan.textContent = `${valCounts[val]}件`;
        item.appendChild(countSpan);

        itemCheckboxes.push(chk);
        listEl.appendChild(item);
    });

    menu.appendChild(listEl);

    const footerEl = document.createElement('div');
    footerEl.className = 'excel-filter-footer';
    const btnCancel = document.createElement('button');
    btnCancel.type = 'button';
    btnCancel.className = 'btn-filter-cancel';
    btnCancel.textContent = 'キャンセル';
    btnCancel.addEventListener('click', () => {
        menu.style.display = 'none';
    });

    const btnApply = document.createElement('button');
    btnApply.type = 'button';
    btnApply.className = 'btn-filter-apply';
    btnApply.textContent = '適用';
    footerEl.appendChild(btnCancel);
    footerEl.appendChild(btnApply);
    menu.appendChild(footerEl);

    function syncAllCheckbox() {
        const checkedCount = itemCheckboxes.filter(c => c.checked).length;
        if (checkedCount === 0) {
            chkAll.checked = false;
            chkAll.indeterminate = false;
            btnApply.disabled = true;
            btnApply.title = '1つ以上の項目を選択してください';
        } else if (checkedCount === itemCheckboxes.length) {
            chkAll.checked = true;
            chkAll.indeterminate = false;
            btnApply.disabled = false;
            btnApply.title = '';
        } else {
            chkAll.checked = false;
            chkAll.indeterminate = true;
            btnApply.disabled = false;
            btnApply.title = '';
        }
    }

    syncAllCheckbox();

    chkAll.addEventListener('change', () => {
        const checked = chkAll.checked;
        itemCheckboxes.forEach(c => { c.checked = checked; });
        syncAllCheckbox();
    });

    actionsEl.querySelector('#btnFilterSelectAll').addEventListener('click', () => {
        itemCheckboxes.forEach(c => { c.checked = true; });
        syncAllCheckbox();
    });

    actionsEl.querySelector('#btnFilterClearAll').addEventListener('click', () => {
        itemCheckboxes.forEach(c => { c.checked = false; });
        syncAllCheckbox();
    });

    itemCheckboxes.forEach(chk => {
        chk.addEventListener('change', () => {
            syncAllCheckbox();
        });
    });

    btnApply.addEventListener('click', () => {
        const checkedVals = itemCheckboxes.filter(c => c.checked).map(c => c.value);
        if (checkedVals.length === 0) return;
        if (checkedVals.length === sortedVals.length) {
            setColumnFilter(colName, null);
        } else {
            setColumnFilter(colName, checkedVals);
        }
        menu.style.display = 'none';
    });

    const rect = triggerBtn.getBoundingClientRect();
    menu.style.display = 'flex';
    menu.style.top = `${rect.bottom + window.scrollY + 4}px`;
    menu.style.left = `${Math.min(window.innerWidth - 260, Math.max(10, rect.left + window.scrollX - 20))}px`;
}

/**
 * プレビューテーブルの描画（クレンジング判定・フィルター・編集・ページネーション対応）
 */
function renderPreviewTable() {
    const thead = document.getElementById('previewTableThead');
    const tbody = document.getElementById('previewTableTbody');
    const previewShowingInfo = document.getElementById('previewShowingInfo');
    const previewStatsBadge = document.getElementById('previewStatsBadge');
    const previewPagination = document.getElementById('previewPagination');
    const pageInfo = document.getElementById('pageInfo');
    const btnPrevPage = document.getElementById('btnPrevPage');
    const btnNextPage = document.getElementById('btnNextPage');
    const warningRowCount = document.getElementById('warningRowCount');
    const warningAlert = document.getElementById('previewWarningAlert');
    const successAlert = document.getElementById('previewSuccessAlert');
    const warningDesc = document.getElementById('previewWarningDesc');
    const btnFilterWarnings = document.getElementById('btnFilterWarnings');

    if (!thead || !tbody) return;

    // 1. 各行の品質評価とフィルター判定
    const activeFilters = Object.entries(AppState.columnFilters).filter(([_, v]) => {
        if (Array.isArray(v)) return v.length > 0;
        return v !== undefined && v !== null && v !== '';
    });

    let problemCount = 0;
    let emptyCount = 0;
    const allAssessed = [];
    const problemItems = [];

    AppState.rawRows.forEach((row, idx) => {
        // オートフィルター条件判定
        const matchesFilters = activeFilters.every(([col, val]) => isRowMatchFilter(row, col, val));
        if (!matchesFilters) return;

        // 自由記述列の品質チェック
        const rawText = AppState.textCol ? row[AppState.textCol] : '';
        const quality = TextPreprocessor.checkQuality(rawText);
        if (quality.isProblem) {
            problemCount++;
            if (quality.status === 'empty') emptyCount++;
        }

        const item = { row, idx, quality };
        allAssessed.push(item);
        if (quality.isProblem) {
            problemItems.push(item);
        }
    });

    const junkCount = problemCount - emptyCount;
    const validCount = allAssessed.length - problemCount;
    const totalCount = AppState.rawRows.length;

    // バッジおよびアラートの更新
    if (previewStatsBadge) {
        if (problemCount > 0) {
            previewStatsBadge.textContent = `分析対象: ${validCount} 件 (自動除外: ${problemCount} 件 / 全 ${totalCount} 件)`;
        } else if (activeFilters.length > 0) {
            previewStatsBadge.textContent = `全 ${totalCount} 件中 ${validCount} 件`;
        } else {
            previewStatsBadge.textContent = `全 ${totalCount} 件`;
        }
    }
    if (warningRowCount) warningRowCount.textContent = problemCount;

    if (problemCount > 0) {
        if (warningAlert) warningAlert.style.display = 'flex';
        if (successAlert) successAlert.style.display = 'none';
        if (warningDesc) {
            warningDesc.innerHTML = `選択中の自由記述列で、空欄や記号・定型無効回答の <b>${problemCount}件</b> を分析対象から<b>自動的に除外</b>しました（有効な <b>${validCount}件</b> を分析対象とします）。<br><span style="color:#64748B;">※ 自動除外された行（空欄: ${emptyCount}件, 記号・定型等: ${junkCount}件）の内容を確認・編集したい場合は、上の「⚠️ 対象外の行 (${problemCount})」ボタンをクリックしてください。</span>`;
        }
        if (btnFilterWarnings) {
            btnFilterWarnings.style.display = 'inline-flex';
            btnFilterWarnings.innerHTML = `⚠️ 対象外の行 (<span id="warningRowCount">${problemCount}</span>)`;
        }
    } else {
        if (warningAlert) warningAlert.style.display = 'none';
        if (successAlert) successAlert.style.display = 'flex';
        if (btnFilterWarnings) {
            btnFilterWarnings.style.display = 'none';
            AppState.previewFilterWarning = false;
            btnFilterWarnings.classList.remove('active');
        }
    }

    updateActiveFiltersBar();
    updateFocusRunButtons();

    // 2. 表示対象リストの決定
    let itemsToDisplay = AppState.previewFilterWarning ? problemItems : allAssessed;
    const displayCount = itemsToDisplay.length;

    // 3. 表示モード（先頭5件 vs 全件・ページネーション）
    let pageItems = [];
    if (AppState.previewMode === 'limit') {
        pageItems = itemsToDisplay.slice(0, 5);
        if (previewPagination) previewPagination.style.display = 'none';
        if (previewShowingInfo) {
            previewShowingInfo.textContent = `先頭 ${pageItems.length} 件を表示中 (対象: ${displayCount} 件 / 全 ${totalCount} 件)`;
        }
    } else {
        const totalPages = Math.max(1, Math.ceil(itemsToDisplay.length / AppState.previewPageSize));
        if (AppState.previewPage > totalPages) AppState.previewPage = totalPages;
        if (AppState.previewPage < 1) AppState.previewPage = 1;

        const startIdx = (AppState.previewPage - 1) * AppState.previewPageSize;
        const endIdx = Math.min(itemsToDisplay.length, startIdx + AppState.previewPageSize);
        pageItems = itemsToDisplay.slice(startIdx, endIdx);

        if (itemsToDisplay.length > AppState.previewPageSize) {
            if (previewPagination) previewPagination.style.display = 'flex';
            if (pageInfo) pageInfo.textContent = `${AppState.previewPage} / ${totalPages} ページ`;
            if (btnPrevPage) btnPrevPage.disabled = (AppState.previewPage <= 1);
            if (btnNextPage) btnNextPage.disabled = (AppState.previewPage >= totalPages);
        } else {
            if (previewPagination) previewPagination.style.display = 'none';
        }

        const showStart = itemsToDisplay.length > 0 ? (startIdx + 1) : 0;
        if (previewShowingInfo) {
            previewShowingInfo.textContent = `${showStart}〜${endIdx} 件を表示中 (対象: ${displayCount} 件 / 全 ${totalCount} 件)`;
        }
    }

    // 4. ヘッダー描画
    let theadHtml = '<th class="col-check"><input type="checkbox" id="checkSelectAll" title="表示中の行をすべて選択 / 解除"></th>';
    theadHtml += '<th style="width: 45px; text-align: center;">#</th>';
    AppState.headers.forEach(h => {
        const isTarget = (h === AppState.textCol);
        const isAttr = (h === AppState.attrCol);
        const filterVals = AppState.columnFilters[h];
        const hasFilter = Array.isArray(filterVals) ? filterVals.length > 0 : (filterVals !== undefined && filterVals !== null && filterVals !== '');
        const filterBadgeText = hasFilter ? (Array.isArray(filterVals) && filterVals.length > 1 ? `▼ 絞込中(${filterVals.length})` : '▼ 絞込中') : '▼';
        const colClass = isTarget ? 'col-target' : (isAttr ? 'col-attr' : '');
        const badgeHtml = isTarget ? '<span class="badge-col-target">自由記述</span>' : (isAttr ? '<span class="badge-col-attr">属性</span>' : '');

        const filterBtnHtml = !isTarget ? `
            <button type="button" class="btn-th-filter ${hasFilter ? 'has-filter' : ''}" data-col="${escapeHtml(h)}" title="${escapeHtml(h)} で絞り込み">
                ${filterBadgeText}
            </button>
        ` : '';

        theadHtml += `<th class="${colClass}">
            <div class="th-header-inner">
                <span>${escapeHtml(h)} ${badgeHtml}</span>
                ${filterBtnHtml}
            </div>
        </th>`;
    });
    theadHtml += '<th style="width: 90px; text-align: center;">入力状態</th>';
    theadHtml += '<th style="width: 45px; text-align: center;">削除</th>';
    thead.innerHTML = theadHtml;

    thead.querySelectorAll('.btn-th-filter').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const col = btn.getAttribute('data-col');
            if (col) showColumnFilterMenu(btn, col);
        });
    });

    // 5. ボディ描画
    if (pageItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${AppState.headers.length + 4}" style="text-align: center; color: #94A3B8; padding: 24px;">該当するデータはありません</td></tr>`;
        updateBulkDeleteBtn();
        updateSelectAllState();
        return;
    }

    let tbodyHtml = '';
    pageItems.forEach(item => {
        const isProblem = item.quality.isProblem;
        const isSelected = AppState.selectedRowIndices.has(item.idx);
        const rowClass = `${isProblem ? 'row-problem' : ''} ${isSelected ? 'row-selected' : ''}`.trim();
        const badgeClass = isProblem 
            ? (item.quality.status === 'empty' ? 'badge-status-empty' : 'badge-status-junk')
            : 'badge-status-valid';

        tbodyHtml += `<tr class="${rowClass}" id="previewRow_${item.idx}">`;
        tbodyHtml += `<td class="col-check"><input type="checkbox" class="row-checkbox" data-row-idx="${item.idx}" ${isSelected ? 'checked' : ''} aria-label="行を選択"></td>`;
        tbodyHtml += `<td style="color:#64748B; font-weight:600; text-align:center;">${item.idx + 1}</td>`;

        AppState.headers.forEach(h => {
            const rawVal = item.row[h];
            const textVal = (rawVal !== undefined && rawVal !== null) ? String(rawVal) : '';
            const isTargetCol = (h === AppState.textCol);
            const colClass = isTargetCol ? 'col-target-cell' : '';

            tbodyHtml += `<td class="cell-editable ${colClass}" contenteditable="true" data-row-idx="${item.idx}" data-col="${escapeHtml(h)}" title="クリックして編集">${escapeHtml(textVal)}</td>`;
        });

        const statusLabel = isProblem ? `対象外: ${item.quality.label}` : item.quality.label;
        tbodyHtml += `<td style="text-align:center;"><span class="badge-status ${badgeClass}" id="badgeStatus_${item.idx}" title="${escapeHtml(item.quality.detail)}">${statusLabel}</span></td>`;
        tbodyHtml += `<td style="text-align:center;"><button type="button" class="btn-row-del" data-row-idx="${item.idx}" title="この行を削除">🗑️</button></td>`;
        tbodyHtml += '</tr>';
    });

    tbody.innerHTML = tbodyHtml;
    updateBulkDeleteBtn();
    updateSelectAllState();
}

/**
 * 一括削除ボタンの表示・件数更新
 */
function updateBulkDeleteBtn() {
    const btnBulkDelete = document.getElementById('btnBulkDelete');
    const countSpan = document.getElementById('selectedRowCount');
    const count = AppState.selectedRowIndices.size;
    if (countSpan) countSpan.textContent = count;
    if (btnBulkDelete) {
        btnBulkDelete.style.display = count > 0 ? 'inline-flex' : 'none';
    }
}

/**
 * テーブルヘッダーの全選択チェックボックスの同期
 */
function updateSelectAllState() {
    const checkSelectAll = document.getElementById('checkSelectAll');
    if (!checkSelectAll) return;
    const checkboxes = document.querySelectorAll('#previewTableTbody .row-checkbox');
    if (checkboxes.length === 0) {
        checkSelectAll.checked = false;
        checkSelectAll.indeterminate = false;
        return;
    }
    let checkedCount = 0;
    checkboxes.forEach(cb => {
        if (cb.checked) checkedCount++;
    });
    if (checkedCount === 0) {
        checkSelectAll.checked = false;
        checkSelectAll.indeterminate = false;
    } else if (checkedCount === checkboxes.length) {
        checkSelectAll.checked = true;
        checkSelectAll.indeterminate = false;
    } else {
        checkSelectAll.checked = false;
        checkSelectAll.indeterminate = true;
    }
}

/**
 * セル編集後の単一行および全体アラートの差分更新
 */
function updateRowAndAlertsAfterEdit(rowIdx) {
    const row = AppState.rawRows[rowIdx];
    if (!row) return;

    const quality = TextPreprocessor.checkQuality(row[AppState.textCol]);
    const tr = document.getElementById(`previewRow_${rowIdx}`);
    const badge = document.getElementById(`badgeStatus_${rowIdx}`);

    if (tr) {
        if (quality.isProblem) {
            tr.classList.add('row-problem');
        } else {
            tr.classList.remove('row-problem');
        }
    }

    if (badge) {
        const badgeClass = quality.isProblem 
            ? (quality.status === 'empty' ? 'badge-status-empty' : 'badge-status-junk')
            : 'badge-status-valid';
        badge.className = `badge-status ${badgeClass}`;
        badge.textContent = quality.isProblem ? `対象外: ${quality.label}` : quality.label;
        badge.title = quality.detail;
    }

    // 問題件数の再集計
    let problemCount = 0;
    let emptyCount = 0;
    const activeFilters = Object.entries(AppState.columnFilters).filter(([_, v]) => {
        if (Array.isArray(v)) return v.length > 0;
        return v !== undefined && v !== null && v !== '';
    });
    const currentRows = AppState.rawRows.filter(r => activeFilters.every(([col, val]) => isRowMatchFilter(r, col, val)));
    currentRows.forEach(r => {
        const q = TextPreprocessor.checkQuality(r[AppState.textCol]);
        if (q.isProblem) {
            problemCount++;
            if (q.status === 'empty') emptyCount++;
        }
    });
    const junkCount = problemCount - emptyCount;
    const validCount = currentRows.length - problemCount;
    const totalCount = AppState.rawRows.length;

    const warningAlert = document.getElementById('previewWarningAlert');
    const successAlert = document.getElementById('previewSuccessAlert');
    const warningDesc = document.getElementById('previewWarningDesc');
    const warningRowCount = document.getElementById('warningRowCount');
    const previewStatsBadge = document.getElementById('previewStatsBadge');

    if (previewStatsBadge) {
        if (problemCount > 0) {
            previewStatsBadge.textContent = `分析対象: ${validCount} 件 (自動除外: ${problemCount} 件 / 全 ${totalCount} 件)`;
        } else if (activeFilters.length > 0) {
            previewStatsBadge.textContent = `全 ${totalCount} 件中 ${validCount} 件`;
        } else {
            previewStatsBadge.textContent = `全 ${totalCount} 件`;
        }
    }

    if (warningRowCount) warningRowCount.textContent = problemCount;

    if (problemCount > 0) {
        if (warningAlert) warningAlert.style.display = 'flex';
        if (successAlert) successAlert.style.display = 'none';
        if (warningDesc) {
            warningDesc.innerHTML = `選択中の自由記述列で、空欄や記号・定型無効回答の <b>${problemCount}件</b> を分析対象から<b>自動的に除外</b>しました（有効な <b>${validCount}件</b> を分析対象とします）。<br><span style="color:#64748B;">※ 自動除外された行（空欄: ${emptyCount}件, 記号・定型等: ${junkCount}件）の内容を確認・編集したい場合は、上の「⚠️ 対象外の行 (${problemCount})」ボタンをクリックしてください。</span>`;
        }
    } else {
        if (warningAlert) warningAlert.style.display = 'none';
        if (successAlert) successAlert.style.display = 'flex';
    }
}

/**
 * 新しい空行をテーブル先頭に追加
 */
function addNewRow() {
    if (!AppState.headers || AppState.headers.length === 0) return;
    const newRow = {};
    AppState.headers.forEach(h => {
        newRow[h] = '';
    });

    // 選択インデックスを1つずつシフト
    const shiftedSet = new Set();
    AppState.selectedRowIndices.forEach(idx => shiftedSet.add(idx + 1));
    AppState.selectedRowIndices = shiftedSet;

    AppState.rawRows.unshift(newRow);
    AppState.isTokenized = false;
    AppState.previewPage = 1;
    renderPreviewTable();
    updateFocusRunButtons();

    // 先頭行の自由記述セルにフォーカス
    const firstCell = document.querySelector('#previewTableTbody tr:first-child .cell-editable');
    if (firstCell) firstCell.focus();
}

/**
 * 指定したインデックスの行を削除
 */
function deleteRow(rowIdx) {
    if (confirm(`行 #${rowIdx + 1} を削除しますか？`)) {
        AppState.rawRows.splice(rowIdx, 1);
        AppState.selectedRowIndices.delete(rowIdx);

        // 削除位置より後ろのインデックスを繰り下げ
        const updatedSet = new Set();
        AppState.selectedRowIndices.forEach(idx => {
            if (idx < rowIdx) updatedSet.add(idx);
            else if (idx > rowIdx) updatedSet.add(idx - 1);
        });
        AppState.selectedRowIndices = updatedSet;

        AppState.isTokenized = false;
        renderPreviewTable();
        updateFocusRunButtons();
    }
}

/**
 * 選択中の行を一括削除
 */
function deleteSelectedRows() {
    const count = AppState.selectedRowIndices.size;
    if (count === 0) return;
    if (confirm(`選択した ${count} 件のデータを一括削除しますか？`)) {
        const sorted = Array.from(AppState.selectedRowIndices).sort((a, b) => b - a);
        sorted.forEach(idx => {
            AppState.rawRows.splice(idx, 1);
        });
        AppState.selectedRowIndices.clear();
        AppState.isTokenized = false;
        renderPreviewTable();
        updateFocusRunButtons();
    }
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

        // 2. カスタム辞書・ルールおよび抽出オプションの最新反映
        TextPreprocessor.setCustomRules({
            stopWords: AppState.customStopWords,
            compoundWords: AppState.customCompoundWords,
            synonymRules: AppState.customSynonymRules
        });
        TextPreprocessor.options = { ...AppState.filterOptions };

        // 3. 必要に応じて全行の形態素解析を実施
        const targetRows = getFilteredRows();
        if (targetRows.length === 0) {
            alert('分析対象となる有効なデータ行がありません。絞り込み条件やデータ内容を確認してください。');
            return;
        }

        if (!AppState.isTokenized || !AppState.tokensPerDoc || AppState.tokensPerDoc.length !== targetRows.length) {
            const texts = targetRows.map(r => String(r[AppState.textCol] || ''));
            AppState.tokensPerDoc = TextPreprocessor.tokenizeDocuments(texts, AppState.filterOptions);
            AppState.totalCorpusStats = TextPreprocessor.computeCorpusStats(targetRows, AppState.textCol, AppState.tokensPerDoc);
            AppState.isTokenized = true;
        }

        // 4. キーワード関連語の算出
        const res = AssociationEngine.findRelatedWords(
            AppState.tokensPerDoc,
            targetRows,
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
    const targetRows = getFilteredRows();

    // 1. 意見フィルタリング（AND/OR条件、文単位/回答単位を適用）
    AppState.filterResult = AssociationEngine.filterMatchedOpinions(
        targetRows,
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

    // 切り替え時にDOMサイズ確定を待って正確なコンテナ寸法で描画
    requestAnimationFrame(() => {
        updateVisualizations();
    });
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
            shape: AppState.cloudShape,
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
            colorMode: AppState.networkColorMode,
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
            clusteringMethod: AppState.umapClustering,
            minClusterSize: AppState.umapMinClusterSize,
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

function escapeHtml(str) {
    return (str || '').replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
}

function escapeRegExp(str) {
    return (str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * キャンバスの表示サイズモードを設定
 * @param {'compact' | 'standard' | 'large' | 'fullscreen'} sizeMode
 */
function setCanvasSizeMode(sizeMode) {
    AppState.canvasSizeMode = sizeMode;

    const containers = [
        document.getElementById('cloudCanvasContainer'),
        document.getElementById('networkCanvasContainer'),
        document.getElementById('umapCanvasContainer'),
        document.getElementById('attrCanvasContainer')
    ];

    containers.forEach(c => {
        if (!c) return;
        c.classList.remove('size-compact', 'size-standard', 'size-large', 'size-fullscreen');
        c.classList.add(`size-${sizeMode}`);
    });

    // ボタンアクティブ状態
    document.querySelectorAll('.view-size-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.size === sizeMode);
    });

    // 全画面ボタンのラベル切り替え
    const btnFullscreen = document.getElementById('btnToggleFullscreen');
    if (btnFullscreen) {
        btnFullscreen.innerHTML = (sizeMode === 'fullscreen') ? '✕ 全画面終了' : '⛶ 全画面';
        btnFullscreen.classList.toggle('btn-primary', sizeMode === 'fullscreen');
    }

    // 全画面時のスクロール制御
    if (sizeMode === 'fullscreen') {
        document.body.style.overflow = 'hidden';
    } else {
        document.body.style.overflow = '';
    }

    // DOMサイズ確定後に再描画
    requestAnimationFrame(() => {
        updateVisualizations();
        // 属性グラフ（Plotly）の明示的リサイズ
        const attrEl = document.getElementById('attrChartContainer');
        if (attrEl && typeof Plotly !== 'undefined' && attrEl.data) {
            Plotly.Plots.resize(attrEl);
        }
    });
}

/**
 * 集中分析モード（上部入力・設定パネルの折りたたみ）の切り替え
 * @param {boolean} [forceState]
 */
function toggleFocusMode(forceState) {
    if (forceState !== undefined) {
        AppState.isFocusMode = forceState;
    } else {
        AppState.isFocusMode = !AppState.isFocusMode;
    }

    const panelsToToggle = [
        document.getElementById('configGrid'),
        document.getElementById('focusSection'),
        document.getElementById('fileStatusBar'),
        document.getElementById('coveragePanel')
    ];

    panelsToToggle.forEach(p => {
        if (p) p.classList.toggle('panel-collapsed', AppState.isFocusMode);
    });

    const banner = document.getElementById('focusModeBanner');
    if (banner) {
        banner.style.display = AppState.isFocusMode ? 'flex' : 'none';
    }

    const btnText = document.getElementById('focusModeText');
    const btnIcon = document.getElementById('focusModeIcon');
    if (btnText && btnIcon) {
        btnText.textContent = AppState.isFocusMode ? '入力・設定パネルを表示' : '上部を折りたたむ (画面を広く使う)';
        btnIcon.textContent = AppState.isFocusMode ? '🔽' : '🔼';
    }

    // 折りたたみによる画面スペース変化に合わせて再描画
    requestAnimationFrame(() => {
        updateVisualizations();
    });
}

/* ========================================================
   STEP 2: 抽出品詞 ＆ カスタム辞書・除外ワード管理
   ======================================================== */

let pendingImportRules = null;

/**
 * トースト通知の表示
 * @param {string} msg 
 */
function showToast(msg) {
    let toast = document.getElementById('toastNotification');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toastNotification';
        toast.className = 'toast-notification';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.display = 'block';
    toast.style.opacity = '1';

    if (toast._timer) clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => { toast.style.display = 'none'; }, 250);
    }, 2800);
}

/**
 * カスタムルールのLocalStorageへの保存
 */
function saveCustomRulesToStorage() {
    try {
        const data = {
            stopWords: Array.from(AppState.customStopWords),
            compoundWords: Array.from(AppState.customCompoundWords),
            synonymRules: Array.from(AppState.customSynonymRules.entries()),
            filterOptions: AppState.filterOptions
        };
        localStorage.setItem('focus_explorer_custom_rules', JSON.stringify(data));
    } catch (e) {
        console.warn('Failed to save custom rules to localStorage:', e);
    }
}

/**
 * カスタムルールのLocalStorageからの復元
 */
function loadCustomRulesFromStorage() {
    try {
        const raw = localStorage.getItem('focus_explorer_custom_rules');
        if (raw) {
            const data = JSON.parse(raw);
            if (Array.isArray(data.stopWords)) {
                AppState.customStopWords = new Set(data.stopWords);
            }
            if (Array.isArray(data.compoundWords)) {
                AppState.customCompoundWords = new Set(data.compoundWords);
            }
            if (Array.isArray(data.synonymRules)) {
                AppState.customSynonymRules = new Map(data.synonymRules);
            }
            if (data.filterOptions) {
                AppState.filterOptions = { ...AppState.filterOptions, ...data.filterOptions };
            }
        }
    } catch (e) {
        console.warn('Failed to load custom rules from localStorage:', e);
    }
}

/**
 * 抽出品詞選択イベントのセットアップ
 */
function setupPosEvents() {
    const posCheckboxes = document.querySelectorAll('.pos-checkbox');
    const btnPosReset = document.getElementById('btnPosReset');
    const btnPosSelectAll = document.getElementById('btnPosSelectAll');
    const checkMerge = document.getElementById('checkMergeNouns');
    const checkStop = document.getElementById('checkUseStopwords');

    // チェックボックスの初期状態反映
    posCheckboxes.forEach(cb => {
        const pos = cb.getAttribute('data-pos');
        if (pos === 'noun') cb.checked = AppState.filterOptions.posNoun;
        else if (pos === 'verb') cb.checked = AppState.filterOptions.posVerb;
        else if (pos === 'adj') cb.checked = AppState.filterOptions.posAdj;
        else if (pos === 'adv') cb.checked = AppState.filterOptions.posAdv;
        else if (pos === 'intj') cb.checked = AppState.filterOptions.posIntj || false;

        const parentChip = cb.closest('.pos-chip');
        if (parentChip) parentChip.classList.toggle('is-checked', cb.checked);

        cb.addEventListener('change', () => {
            const checkedCount = Array.from(posCheckboxes).filter(c => c.checked).length;
            if (checkedCount === 0) {
                alert('少なくとも1つの品詞を選択してください');
                cb.checked = true;
                return;
            }

            if (parentChip) parentChip.classList.toggle('is-checked', cb.checked);

            if (pos === 'noun') AppState.filterOptions.posNoun = cb.checked;
            else if (pos === 'verb') AppState.filterOptions.posVerb = cb.checked;
            else if (pos === 'adj') AppState.filterOptions.posAdj = cb.checked;
            else if (pos === 'adv') AppState.filterOptions.posAdv = cb.checked;
            else if (pos === 'intj') AppState.filterOptions.posIntj = cb.checked;

            AppState.isTokenized = false;
            saveCustomRulesToStorage();

            if (AppState.rawRows.length > 0 && AppState.targetKeyword) {
                runFocusAnalysis();
            }
        });
    });

    if (btnPosReset) {
        btnPosReset.addEventListener('click', () => {
            AppState.filterOptions.posNoun = true;
            AppState.filterOptions.posVerb = true;
            AppState.filterOptions.posAdj = true;
            AppState.filterOptions.posAdv = false;
            AppState.filterOptions.posIntj = false;

            posCheckboxes.forEach(cb => {
                const pos = cb.getAttribute('data-pos');
                cb.checked = (pos === 'noun' || pos === 'verb' || pos === 'adj');
                const chip = cb.closest('.pos-chip');
                if (chip) chip.classList.toggle('is-checked', cb.checked);
            });

            AppState.isTokenized = false;
            saveCustomRulesToStorage();
            showToast('抽出品詞を標準設定（名詞・動詞・形容詞）に戻しました');
            if (AppState.rawRows.length > 0 && AppState.targetKeyword) {
                runFocusAnalysis();
            }
        });
    }

    if (btnPosSelectAll) {
        btnPosSelectAll.addEventListener('click', () => {
            AppState.filterOptions.posNoun = true;
            AppState.filterOptions.posVerb = true;
            AppState.filterOptions.posAdj = true;
            AppState.filterOptions.posAdv = true;
            AppState.filterOptions.posIntj = true;

            posCheckboxes.forEach(cb => {
                cb.checked = true;
                const chip = cb.closest('.pos-chip');
                if (chip) chip.classList.add('is-checked');
            });

            AppState.isTokenized = false;
            saveCustomRulesToStorage();
            showToast('すべての品詞を選択しました');
            if (AppState.rawRows.length > 0 && AppState.targetKeyword) {
                runFocusAnalysis();
            }
        });
    }

    if (checkMerge) {
        checkMerge.checked = AppState.filterOptions.mergeCompoundNouns;
        checkMerge.addEventListener('change', () => {
            AppState.filterOptions.mergeCompoundNouns = checkMerge.checked;
            AppState.isTokenized = false;
            saveCustomRulesToStorage();
            if (AppState.rawRows.length > 0 && AppState.targetKeyword) {
                runFocusAnalysis();
            }
        });
    }

    if (checkStop) {
        checkStop.checked = AppState.filterOptions.useDefaultStopwords;
        checkStop.addEventListener('change', () => {
            AppState.filterOptions.useDefaultStopwords = checkStop.checked;
            AppState.isTokenized = false;
            saveCustomRulesToStorage();
            if (AppState.rawRows.length > 0 && AppState.targetKeyword) {
                runFocusAnalysis();
            }
        });
    }
}

/**
 * カスタム辞書・除外ワードUIの更新
 */
function renderCustomRulesUI() {
    const stopwordsList = document.getElementById('stopwordsList');
    const compoundWordsList = document.getElementById('compoundWordsList');
    const synonymRulesList = document.getElementById('synonymRulesList');
    const badgeStop = document.getElementById('badgeStopwordsCount');
    const badgeComp = document.getElementById('badgeCompoundsCount');
    const badgeSyn = document.getElementById('badgeSynonymsCount');
    const summaryBadge = document.getElementById('dictRuleSummaryBadge');

    if (!stopwordsList || !compoundWordsList || !synonymRulesList) return;

    // ① 除外ワード
    stopwordsList.innerHTML = '';
    const sortedStop = Array.from(AppState.customStopWords).sort((a, b) => a.localeCompare(b, 'ja'));
    sortedStop.forEach(w => {
        const tag = document.createElement('span');
        tag.className = 'dict-tag';
        tag.innerHTML = `<span>${escapeHtml(w)}</span><button type="button" class="dict-tag-remove" data-action="remove-stopword" data-word="${escapeHtml(w)}" title="除外を解除">✕</button>`;
        stopwordsList.appendChild(tag);
    });
    if (badgeStop) badgeStop.textContent = sortedStop.length;

    // ② 複合語
    compoundWordsList.innerHTML = '';
    const sortedComp = Array.from(AppState.customCompoundWords).sort((a, b) => a.localeCompare(b, 'ja'));
    sortedComp.forEach(w => {
        const tag = document.createElement('span');
        tag.className = 'dict-tag';
        tag.innerHTML = `<span>${escapeHtml(w)}</span><button type="button" class="dict-tag-remove" data-action="remove-compound" data-word="${escapeHtml(w)}" title="複合語登録を解除">✕</button>`;
        compoundWordsList.appendChild(tag);
    });
    if (badgeComp) badgeComp.textContent = sortedComp.length;

    // ③ 表記ゆれ
    synonymRulesList.innerHTML = '';
    const sortedSyn = Array.from(AppState.customSynonymRules.entries()).sort((a, b) => a[0].localeCompare(b[0], 'ja'));
    sortedSyn.forEach(([from, to]) => {
        const tag = document.createElement('span');
        tag.className = 'dict-tag';
        tag.innerHTML = `<span><b>${escapeHtml(from)}</b> → ${escapeHtml(to)}</span><button type="button" class="dict-tag-remove" data-action="remove-synonym" data-from="${escapeHtml(from)}" title="表記ゆれルールを解除">✕</button>`;
        synonymRulesList.appendChild(tag);
    });
    if (badgeSyn) badgeSyn.textContent = sortedSyn.length;

    // 合計バッジ
    const totalCount = sortedStop.length + sortedComp.length + sortedSyn.length;
    if (summaryBadge) {
        summaryBadge.textContent = `登録: ${totalCount}件`;
        summaryBadge.classList.toggle('has-rules', totalCount > 0);
    }
}

/**
 * カスタム辞書イベントのセットアップ
 */
function setupDictionaryEvents() {
    const dictHeader = document.getElementById('dictionaryHeader');
    const dictSection = document.getElementById('dictionarySection');
    const dictBody = document.getElementById('dictionaryBody');

    // アコーディオン開閉
    if (dictHeader && dictSection && dictBody) {
        dictHeader.addEventListener('click', () => {
            const isOpen = dictSection.classList.toggle('is-open');
            dictBody.style.display = isOpen ? 'block' : 'none';
        });
    }

    // ① 除外ワード追加
    const inputStop = document.getElementById('inputNewStopword');
    const btnAddStop = document.getElementById('btnAddStopword');
    const addStopwordAction = () => {
        const w = (inputStop.value || '').trim();
        if (!w) return;
        AppState.customStopWords.add(w);
        inputStop.value = '';
        AppState.isTokenized = false;
        saveCustomRulesToStorage();
        renderCustomRulesUI();
        showToast(`除外ワードに「${w}」を追加しました`);
        if (AppState.rawRows.length > 0 && AppState.targetKeyword) {
            runFocusAnalysis();
        }
    };
    if (btnAddStop) btnAddStop.addEventListener('click', addStopwordAction);
    if (inputStop) {
        inputStop.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addStopwordAction();
            }
        });
    }

    // 除外ワード削除
    const stopwordsList = document.getElementById('stopwordsList');
    if (stopwordsList) {
        stopwordsList.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action="remove-stopword"]');
            if (btn) {
                const w = btn.getAttribute('data-word');
                if (w && AppState.customStopWords.has(w)) {
                    AppState.customStopWords.delete(w);
                    AppState.isTokenized = false;
                    saveCustomRulesToStorage();
                    renderCustomRulesUI();
                    showToast(`除外ワード「${w}」を解除しました`);
                    if (AppState.rawRows.length > 0 && AppState.targetKeyword) {
                        runFocusAnalysis();
                    }
                }
            }
        });
    }

    const btnResetStopwords = document.getElementById('btnResetStopwords');
    if (btnResetStopwords) {
        btnResetStopwords.addEventListener('click', () => {
            if (AppState.customStopWords.size === 0) return;
            if (confirm('登録した除外ワードをクリアしますか？')) {
                AppState.customStopWords.clear();
                AppState.isTokenized = false;
                saveCustomRulesToStorage();
                renderCustomRulesUI();
                showToast('除外ワードをクリアしました');
                if (AppState.rawRows.length > 0 && AppState.targetKeyword) {
                    runFocusAnalysis();
                }
            }
        });
    }

    // ② 複合語追加
    const inputCompound = document.getElementById('inputNewCompound');
    const btnAddCompound = document.getElementById('btnAddCompound');
    const addCompoundAction = () => {
        const w = (inputCompound.value || '').trim();
        if (!w) return;
        AppState.customCompoundWords.add(w);
        inputCompound.value = '';
        AppState.isTokenized = false;
        saveCustomRulesToStorage();
        renderCustomRulesUI();
        showToast(`複合語に「${w}」を追加しました`);
        if (AppState.rawRows.length > 0 && AppState.targetKeyword) {
            runFocusAnalysis();
        }
    };
    if (btnAddCompound) btnAddCompound.addEventListener('click', addCompoundAction);
    if (inputCompound) {
        inputCompound.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addCompoundAction();
            }
        });
    }

    const compoundWordsList = document.getElementById('compoundWordsList');
    if (compoundWordsList) {
        compoundWordsList.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action="remove-compound"]');
            if (btn) {
                const w = btn.getAttribute('data-word');
                if (w && AppState.customCompoundWords.has(w)) {
                    AppState.customCompoundWords.delete(w);
                    AppState.isTokenized = false;
                    saveCustomRulesToStorage();
                    renderCustomRulesUI();
                    showToast(`複合語「${w}」を解除しました`);
                    if (AppState.rawRows.length > 0 && AppState.targetKeyword) {
                        runFocusAnalysis();
                    }
                }
            }
        });
    }

    const btnClearCompounds = document.getElementById('btnClearCompounds');
    if (btnClearCompounds) {
        btnClearCompounds.addEventListener('click', () => {
            if (AppState.customCompoundWords.size === 0) return;
            if (confirm('登録した複合語をすべてクリアしますか？')) {
                AppState.customCompoundWords.clear();
                AppState.isTokenized = false;
                saveCustomRulesToStorage();
                renderCustomRulesUI();
                showToast('複合語をすべてクリアしました');
                if (AppState.rawRows.length > 0 && AppState.targetKeyword) {
                    runFocusAnalysis();
                }
            }
        });
    }

    // ③ 表記ゆれ統一追加
    const inputSynFrom = document.getElementById('inputSynonymFrom');
    const inputSynTo = document.getElementById('inputSynonymTo');
    const btnAddSynonym = document.getElementById('btnAddSynonym');
    const addSynonymAction = () => {
        const from = (inputSynFrom.value || '').trim();
        const to = (inputSynTo.value || '').trim();
        if (!from || !to) {
            alert('「元の語」と「統一後の語」を両方入力してください');
            return;
        }
        AppState.customSynonymRules.set(from, to);
        inputSynFrom.value = '';
        inputSynTo.value = '';
        AppState.isTokenized = false;
        saveCustomRulesToStorage();
        renderCustomRulesUI();
        showToast(`表記ゆれ統一「${from} → ${to}」を追加しました`);
        if (AppState.rawRows.length > 0 && AppState.targetKeyword) {
            runFocusAnalysis();
        }
    };
    if (btnAddSynonym) btnAddSynonym.addEventListener('click', addSynonymAction);
    if (inputSynTo) {
        inputSynTo.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addSynonymAction();
            }
        });
    }

    const synonymRulesList = document.getElementById('synonymRulesList');
    if (synonymRulesList) {
        synonymRulesList.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action="remove-synonym"]');
            if (btn) {
                const from = btn.getAttribute('data-from');
                if (from && AppState.customSynonymRules.has(from)) {
                    AppState.customSynonymRules.delete(from);
                    AppState.isTokenized = false;
                    saveCustomRulesToStorage();
                    renderCustomRulesUI();
                    showToast(`表記ゆれ統一「${from}」を解除しました`);
                    if (AppState.rawRows.length > 0 && AppState.targetKeyword) {
                        runFocusAnalysis();
                    }
                }
            }
        });
    }

    const btnClearSynonyms = document.getElementById('btnClearSynonyms');
    if (btnClearSynonyms) {
        btnClearSynonyms.addEventListener('click', () => {
            if (AppState.customSynonymRules.size === 0) return;
            if (confirm('登録した表記ゆれルールをすべてクリアしますか？')) {
                AppState.customSynonymRules.clear();
                AppState.isTokenized = false;
                saveCustomRulesToStorage();
                renderCustomRulesUI();
                showToast('表記ゆれルールをすべてクリアしました');
                if (AppState.rawRows.length > 0 && AppState.targetKeyword) {
                    runFocusAnalysis();
                }
            }
        });
    }

    // 全クリア
    const btnClearAllRules = document.getElementById('btnClearAllRules');
    if (btnClearAllRules) {
        btnClearAllRules.addEventListener('click', () => {
            const total = AppState.customStopWords.size + AppState.customCompoundWords.size + AppState.customSynonymRules.size;
            if (total === 0) {
                alert('登録されているカスタムルールはありません');
                return;
            }
            if (confirm(`登録されているすべてのルール（計${total}件）を初期化しますか？`)) {
                AppState.customStopWords.clear();
                AppState.customCompoundWords.clear();
                AppState.customSynonymRules.clear();
                AppState.isTokenized = false;
                saveCustomRulesToStorage();
                renderCustomRulesUI();
                showToast('すべてのカスタムルールを初期化しました');
                if (AppState.rawRows.length > 0 && AppState.targetKeyword) {
                    runFocusAnalysis();
                }
            }
        });
    }

    // ルール設定ファイルのエクスポート
    const btnExport = document.getElementById('btnExportRules');
    if (btnExport) {
        btnExport.addEventListener('click', () => {
            exportRulesFile();
        });
    }

    // ルール設定ファイルのインポート
    const btnImport = document.getElementById('btnImportRules');
    const fileInput = document.getElementById('rulesFileInput');
    if (btnImport && fileInput) {
        btnImport.addEventListener('click', () => {
            fileInput.click();
        });
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            try {
                const text = await file.text();
                handleRulesFileImport(text);
            } catch (err) {
                alert('ファイルの読み込みに失敗しました: ' + err.message);
            } finally {
                fileInput.value = '';
            }
        });
    }

    // インポート確認モーダル
    const modal = document.getElementById('rulesImportModal');
    const btnClose = document.getElementById('btnRulesModalClose');
    const btnReplace = document.getElementById('btnImportReplace');
    const btnMerge = document.getElementById('btnImportMerge');

    if (btnClose && modal) {
        btnClose.addEventListener('click', () => { modal.style.display = 'none'; });
    }
    if (btnReplace && modal) {
        btnReplace.addEventListener('click', () => {
            if (!pendingImportRules) return;
            AppState.customStopWords = new Set(pendingImportRules.stopWords);
            AppState.customCompoundWords = new Set(pendingImportRules.compoundWords);
            AppState.customSynonymRules = new Map(pendingImportRules.synonymRules);
            modal.style.display = 'none';
            pendingImportRules = null;
            AppState.isTokenized = false;
            saveCustomRulesToStorage();
            renderCustomRulesUI();
            showToast('ルールを上書き読み込みしました');
            if (AppState.rawRows.length > 0 && AppState.targetKeyword) {
                runFocusAnalysis();
            }
        });
    }
    if (btnMerge && modal) {
        btnMerge.addEventListener('click', () => {
            if (!pendingImportRules) return;
            pendingImportRules.stopWords.forEach(w => AppState.customStopWords.add(w));
            pendingImportRules.compoundWords.forEach(w => AppState.customCompoundWords.add(w));
            pendingImportRules.synonymRules.forEach((to, from) => AppState.customSynonymRules.set(from, to));
            modal.style.display = 'none';
            pendingImportRules = null;
            AppState.isTokenized = false;
            saveCustomRulesToStorage();
            renderCustomRulesUI();
            showToast('ルールを追加（マージ）しました');
            if (AppState.rawRows.length > 0 && AppState.targetKeyword) {
                runFocusAnalysis();
            }
        });
    }

    renderCustomRulesUI();
}

/**
 * ルールファイルの読み込みハンドラ
 */
function handleRulesFileImport(text) {
    const parsed = TextPreprocessor.parseRulesText(text);
    const total = parsed.stopWords.size + parsed.compoundWords.size + parsed.synonymRules.size;

    if (total === 0) {
        if (parsed.unclassifiedWords && parsed.unclassifiedWords.length > 0) {
            if (confirm(`セクション見出しが見つかりませんでしたが、${parsed.unclassifiedWords.length} 個の単語が検出されました。\nこれらを「除外ワード」として登録しますか？`)) {
                parsed.unclassifiedWords.forEach(w => AppState.customStopWords.add(w));
                saveCustomRulesToStorage();
                renderCustomRulesUI();
                showToast(`除外ワードに ${parsed.unclassifiedWords.length} 件を追加しました`);
                AppState.isTokenized = false;
                if (AppState.rawRows.length > 0 && AppState.targetKeyword) {
                    runFocusAnalysis();
                }
            }
            return;
        }
        alert('有効な除外ワード、複合語、表記ゆれルールが見つかりませんでした。\n「見本ファイル」を参考にしてください。');
        return;
    }

    pendingImportRules = parsed;
    const modal = document.getElementById('rulesImportModal');
    const modalStop = document.getElementById('modalStopwordCount');
    const modalComp = document.getElementById('modalCompoundCount');
    const modalSyn = document.getElementById('modalSynonymCount');

    if (modalStop) modalStop.textContent = parsed.stopWords.size;
    if (modalComp) modalComp.textContent = parsed.compoundWords.size;
    if (modalSyn) modalSyn.textContent = parsed.synonymRules.size;

    if (modal) modal.style.display = 'flex';
}

/**
 * ルール設定ファイル（custom_rules.txt）のエクスポート
 */
function exportRulesFile() {
    const lines = [
        '# ========================================================',
        '# アンケート分析 - 辞書・ルール設定ファイル',
        `# 出力日時: ${new Date().toLocaleString('ja-JP')}`,
        '# ========================================================',
        '',
        '# [複合語]',
        '# 形態素解析で分割されたくない単語を1行に1つずつ記述します。'
    ];
    AppState.customCompoundWords.forEach(w => lines.push(w));

    lines.push('', '# [除外ワード]', '# 分析から除外したい不要語を1行に1つずつ記述します。');
    AppState.customStopWords.forEach(w => lines.push(w));

    lines.push('', '# [表記ゆれ]', '# 表記ゆれや同義語を「元の語 -> 統一後の語」の形式で記述します。');
    AppState.customSynonymRules.forEach((to, from) => {
        lines.push(`${from} -> ${to}`);
    });

    const content = lines.join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'custom_rules.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('辞書設定ファイル (custom_rules.txt) を出力しました');
}

/**
 * 頻出キーワード候補（サジェストチップ）の描画
 */
function renderFrequentKeywordsSuggest() {
    const bar = document.getElementById('frequentKeywordsBar');
    const list = document.getElementById('frequentKeywordsList');
    if (!bar || !list) return;

    if (!AppState.rawRows.length || !AppState.textCol) {
        bar.style.display = 'none';
        list.innerHTML = '';
        return;
    }

    // 有効な行テキストから頻出名詞を簡易集計
    const targetRows = getFilteredRows();
    const wordCounts = {};

    targetRows.forEach(r => {
        const text = String(r[AppState.textCol] || '');
        const tokens = TextPreprocessor.fallbackTokenize(text);
        tokens.forEach(w => {
            if (w.length < 2) return;
            if (TextPreprocessor.isStopWord(w)) return;
            wordCounts[w] = (wordCounts[w] || 0) + 1;
        });
    });

    const sortedWords = Object.entries(wordCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    if (sortedWords.length === 0) {
        bar.style.display = 'none';
        list.innerHTML = '';
        return;
    }

    bar.style.display = 'flex';
    list.innerHTML = '';

    sortedWords.forEach(([w, count]) => {
        const chip = document.createElement('span');
        chip.className = 'kw-suggest-chip';
        chip.textContent = `${w} (${count})`;
        chip.title = `「${w}」をキーワードにセット`;
        chip.addEventListener('click', () => {
            const input = document.getElementById('inputTargetKeyword');
            if (input) {
                input.value = w;
                AppState.targetKeyword = w;
                updateFocusRunButtons();
                input.focus();
            }
        });
        list.appendChild(chip);
    });
}
