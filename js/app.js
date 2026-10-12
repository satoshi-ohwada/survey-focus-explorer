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
    targetKeyword: '物価高',
    relatedWords: [], // [{ word, score, coocCount, docCount, checked }]
    
    // 抽出結果
    filterResult: null, // { totalDocs, matchedCount, matchRate, matchedDocs }
    subcorpusStats: null, // { wordList, wordCounts, docFreq, coocCounts }
    
    // UI状態
    activeTab: 'cloud',
    cloudRanking: 'count',
    cloudMaxWords: 60,
    networkMaxWords: 40,
    networkSpacing: 'wide',
    umapMode: 'words'
};

document.addEventListener('DOMContentLoaded', async () => {
    // 1. 各ビジュアライザーの初期化
    WordCloudVisualizer.init('cloudCanvas');
    NetworkVisualizer.init('networkCanvas');
    UmapVisualizer.init('umapCanvas');
    AttrChartVisualizer.init('attrChartContainer');

    // 2. UIイベントリスナーの登録（即座にクリック可能にする）
    setupUIEvents();

    // 3. 初回デモデータの自動ロード
    loadDemoData();

    // 4. Kuromoji 形態素解析器の非同期初期化（完了後に自動再分析）
    try {
        await TextPreprocessor.init('lib/kuromoji/dict/');
        console.log('Kuromoji initialized successfully.');
        // 初回形態素解析を完了させておく
        if (AppState.rawRows.length > 0 && AppState.textCol) {
            runFocusAnalysis();
        }
    } catch (e) {
        console.warn('Kuromoji init fallback/warning:', e);
        // フォールバックでも動作させる
        if (AppState.rawRows.length > 0 && AppState.textCol) {
            runFocusAnalysis();
        }
    }
});

/**
 * UIイベントリスナーのセットアップ
 */
function setupUIEvents() {
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
    document.getElementById('btnNetworkReset').addEventListener('click', () => {
        updateNetwork();
    });

    // UMAP設定
    document.getElementById('selectUmapMode').addEventListener('change', (e) => {
        AppState.umapMode = e.target.value;
        updateUmap();
    });
    document.getElementById('btnUmapReset').addEventListener('click', () => {
        updateUmap();
    });

    // 意見内検索フィルタ
    document.getElementById('inputFilterOpinionText').addEventListener('input', (e) => {
        renderOpinionsList(e.target.value);
    });

    // 抽出意見CSVダウンロード
    document.getElementById('btnExportMatchedCsv').addEventListener('click', () => {
        exportMatchedOpinionsCsv();
    });

    // 画像保存ボタン
    document.getElementById('btnSaveImage').addEventListener('click', () => {
        saveCurrentImage();
    });

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

    // 初回分析を実行
    runFocusAnalysis();
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
    loadParsedData({
        headers: headers,
        rows: DEMO_SURVEY_DATA,
        fileName: '物価高・生活意識アンケート (デモデータ)'
    });
    document.getElementById('inputTargetKeyword').value = '物価高';
    AppState.targetKeyword = '物価高';
}

/**
 * キーワード ＆ 関連語探索の実行
 */
async function runFocusAnalysis() {
    if (!AppState.rawRows.length || !AppState.textCol) return;

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
            const texts = AppState.rawRows.map(r => String(r[AppState.textCol] || ''));
            AppState.tokensPerDoc = TextPreprocessor.tokenizeDocuments(texts);
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

    if (!AppState.relatedWords.length) {
        container.innerHTML = `<span style="color: var(--text-muted); font-size: 13px;">共起する関連語が見つかりませんでした。別のキーワードをお試しください。</span>`;
        return;
    }

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

        container.appendChild(chip);
    });
}

/**
 * 対象意見の抽出 ＆ 描画
 */
function executeFilteringAndRender() {
    const activeRelated = AppState.relatedWords.filter(r => r.checked).map(r => r.word);

    // 1. 意見フィルタリング
    AppState.filterResult = AssociationEngine.filterMatchedOpinions(
        AppState.rawRows,
        AppState.textCol,
        AppState.attrCol,
        AppState.targetKeyword,
        activeRelated,
        AppState.tokensPerDoc
    );

    // 2. 抽出サマリーバーの更新
    const res = AppState.filterResult;
    document.getElementById('matchSummaryBar').style.display = 'flex';
    document.getElementById('matchedCountDisplay').textContent = `${res.matchedCount} 件`;
    document.getElementById('matchedRateDisplay').textContent = 
        `全 ${res.totalDocs} 件中 ${res.matchedCount} 件の意見を抽出 (${res.matchRate.toFixed(1)}%)`;
    document.getElementById('matchedProgressBar').style.width = `${Math.min(100, res.matchRate)}%`;

    document.getElementById('tabOpinionCount').textContent = res.matchedCount;

    // 3. 抽出意見群の統計集計
    AppState.subcorpusStats = AssociationEngine.computeSubcorpusStats(
        res.matchedDocs,
        TextPreprocessor.DEFAULT_STOPWORDS,
        80
    );

    // ダッシュボードを表示
    document.getElementById('dashboardSection').style.display = 'block';

    // 4. 現在のタブの可視化を更新
    updateVisualizations();
}

/**
 * 可視化の更新
 */
function updateVisualizations() {
    if (!AppState.filterResult) return;

    if (AppState.activeTab === 'cloud') {
        updateWordCloud();
    } else if (AppState.activeTab === 'network') {
        updateNetwork();
    } else if (AppState.activeTab === 'umap') {
        updateUmap();
    } else if (AppState.activeTab === 'attr') {
        updateAttrChart();
    } else if (AppState.activeTab === 'opinions') {
        renderOpinionsList();
    }
}

/**
 * タブ切り替え
 */
function switchTab(tabName) {
    AppState.activeTab = tabName;

    // 各タブコンテンツの表示/非表示
    const tabContents = {
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
    document.getElementById('toolbarCloudCtrl').style.display = (tabName === 'cloud') ? 'block' : 'none';
    document.getElementById('toolbarNetworkCtrl').style.display = (tabName === 'network') ? 'block' : 'none';
    document.getElementById('toolbarUmapCtrl').style.display = (tabName === 'umap') ? 'block' : 'none';
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
            maxWords: AppState.networkMaxWords,
            spacingMode: AppState.networkSpacing,
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
            maxWords: 50,
            onPointClick: (point) => {
                if (point.rawDoc) {
                    // 意見プロットクリック時
                    document.querySelector('.nav-tab-btn[data-tab="opinions"]').click();
                    document.getElementById('inputFilterOpinionText').value = point.rawDoc.matchedWords[0] || '';
                    renderOpinionsList(point.rawDoc.matchedWords[0] || '');
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
 * 生の声（回答文）一覧の描画
 */
function renderOpinionsList(filterKeyword = '') {
    const container = document.getElementById('opinionsListContainer');
    container.innerHTML = '';

    if (!AppState.filterResult || !AppState.filterResult.matchedDocs.length) {
        container.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-muted);">該当する意見がありません</div>`;
        return;
    }

    const docs = AppState.filterResult.matchedDocs;
    const filterLower = (filterKeyword || '').toLowerCase().trim();

    const filteredDocs = filterLower
        ? docs.filter(d => d.text.toLowerCase().includes(filterLower))
        : docs;

    if (filteredDocs.length === 0) {
        container.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-muted);">「${filterKeyword}」に該当する意見が見つかりませんでした</div>`;
        return;
    }

    const targetLower = (AppState.targetKeyword || '').toLowerCase();
    const activeRelated = AppState.relatedWords.filter(r => r.checked).map(r => r.word.toLowerCase());

    filteredDocs.forEach(d => {
        const card = document.createElement('div');
        card.className = 'opinion-card';

        // マッチしたタグ
        const tagsHtml = d.matchedWords.map(w => {
            const isTarget = w.toLowerCase() === targetLower;
            return `<span class="${isTarget ? 'tag-target' : 'tag-related'}">${w}</span>`;
        }).join('');

        // テキストのハイライト生成
        let highlighted = escapeHtml(d.text);
        if (AppState.targetKeyword) {
            const regT = new RegExp(escapeRegExp(AppState.targetKeyword), 'gi');
            highlighted = highlighted.replace(regT, m => `<span class="hl-target">${m}</span>`);
        }
        activeRelated.forEach(rw => {
            if (rw) {
                const regR = new RegExp(escapeRegExp(rw), 'gi');
                highlighted = highlighted.replace(regR, m => `<span class="hl-related">${m}</span>`);
            }
        });

        card.innerHTML = `
            <div class="opinion-meta">
                <div class="opinion-matched-tags">${tagsHtml}</div>
                ${d.attribute ? `<span class="opinion-badge-attr">${escapeHtml(d.attribute)}</span>` : ''}
            </div>
            <div class="opinion-text">${highlighted}</div>
        `;

        container.appendChild(card);
    });
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
 * 現在の図を画像として保存
 */
function saveCurrentImage() {
    let canvas = null;
    let filename = 'chart.png';

    if (AppState.activeTab === 'cloud') {
        canvas = document.getElementById('cloudCanvas');
        filename = `wordcloud_${AppState.targetKeyword}.png`;
    } else if (AppState.activeTab === 'network') {
        canvas = document.getElementById('networkCanvas');
        filename = `network_${AppState.targetKeyword}.png`;
    } else if (AppState.activeTab === 'umap') {
        canvas = document.getElementById('umapCanvas');
        filename = `umap_${AppState.targetKeyword}.png`;
    } else if (AppState.activeTab === 'attr') {
        if (typeof Plotly !== 'undefined') {
            Plotly.downloadImage('attrChartContainer', {
                format: 'png',
                width: 1000,
                height: 600,
                filename: `attr_chart_${AppState.targetKeyword}`
            });
            return;
        }
    }

    if (canvas) {
        const url = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
    }
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
