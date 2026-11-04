/**
 * 共起ネットワーク可視化モジュール
 * Force-Directed 物理演算エンジンによる単語間共起関係の描画
 */
const NetworkVisualizer = {
    canvas: null,
    ctx: null,
    nodes: [],
    edges: [],
    animId: null,
    isDragging: false,
    dragNode: null,
    hoverNode: null,
    scale: 1.0,
    panX: 0,
    panY: 0,
    isPanning: false,
    startX: 0,
    startY: 0,
    targetKeyword: '',
    activeRelatedWords: [],
    onWordClick: null,
    onAttrClick: null,
    networkMode: 'word', // 'word' (単語共起) | 'attr' (属性×単語)
    lastParamsKey: null,

    clearCache() {
        this.lastParamsKey = null;
        this.nodes = [];
        this.edges = [];
    },

    // 属性ノード用カラーパレット
    ATTR_PALETTE: [
        { fill: '#2563eb', stroke: '#1d4ed8', border: '#bfdbfe', text: '#ffffff', light: '#eff6ff' }, // ブルー
        { fill: '#059669', stroke: '#047857', border: '#a7f3d0', text: '#ffffff', light: '#ecfdf5' }, // グリーン
        { fill: '#d97706', stroke: '#b45309', border: '#fde68a', text: '#ffffff', light: '#fffbeb' }, // アンバー
        { fill: '#7c3aed', stroke: '#6d28d9', border: '#ddd6fe', text: '#ffffff', light: '#f5f3ff' }, // パープル
        { fill: '#db2777', stroke: '#be185d', border: '#fbcfe8', text: '#ffffff', light: '#fdf2f8' }, // ピンク
        { fill: '#0891b2', stroke: '#0e7490', border: '#a5f3fc', text: '#ffffff', light: '#ecfeff' }, // シアン
        { fill: '#ea580c', stroke: '#c2410c', border: '#fed7aa', text: '#ffffff', light: '#fff7ed' }, // オレンジ
        { fill: '#475569', stroke: '#334155', border: '#cbd5e1', text: '#ffffff', light: '#f8fafc' }  // スレート
    ],

    init(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        this.setupEvents();
    },

    setupEvents() {
        const c = this.canvas;
        if (!c) return;

        c.addEventListener('mousedown', (e) => {
            const rect = c.getBoundingClientRect();
            const mouseX = (e.clientX - rect.left - this.panX) / this.scale;
            const mouseY = (e.clientY - rect.top - this.panY) / this.scale;

            const hitNode = this.findNodeAt(mouseX, mouseY);
            if (hitNode) {
                this.isDragging = true;
                this.dragNode = hitNode;
                this.dragNode.fx = mouseX;
                this.dragNode.fy = mouseY;
            } else {
                this.isPanning = true;
                this.startX = e.clientX - this.panX;
                this.startY = e.clientY - this.panY;
            }
        });

        window.addEventListener('mousemove', (e) => {
            if (!this.canvas) return;
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = (e.clientX - rect.left - this.panX) / this.scale;
            const mouseY = (e.clientY - rect.top - this.panY) / this.scale;

            if (this.isDragging && this.dragNode) {
                this.dragNode.x = mouseX;
                this.dragNode.y = mouseY;
                this.dragNode.fx = mouseX;
                this.dragNode.fy = mouseY;
                this.renderFrame();
            } else if (this.isPanning) {
                this.panX = e.clientX - this.startX;
                this.panY = e.clientY - this.startY;
                this.renderFrame();
            } else {
                // ホバー検知
                const hit = this.findNodeAt(mouseX, mouseY);
                if (hit !== this.hoverNode) {
                    this.hoverNode = hit;
                    this.canvas.style.cursor = hit ? 'pointer' : 'default';
                    this.renderFrame();
                }
            }
        });

        window.addEventListener('mouseup', () => {
            if (this.isDragging && this.dragNode) {
                this.dragNode.fx = null;
                this.dragNode.fy = null;
                this.isDragging = false;
                this.dragNode = null;
            }
            this.isPanning = false;
        });

        c.addEventListener('click', (e) => {
            const rect = c.getBoundingClientRect();
            const mouseX = (e.clientX - rect.left - this.panX) / this.scale;
            const mouseY = (e.clientY - rect.top - this.panY) / this.scale;
            const hit = this.findNodeAt(mouseX, mouseY);
            if (hit) {
                if (hit.isAttrNode && typeof this.onAttrClick === 'function') {
                    this.onAttrClick(hit.attrCategory);
                } else if (!hit.isAttrNode && typeof this.onWordClick === 'function') {
                    this.onWordClick(hit.id);
                }
            }
        });

        c.addEventListener('wheel', (e) => {
            // CtrlキーまたはCmdキーが押されている場合のみ図のズームを行う（スクロールトラップ防止）
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
                this.zoom(zoomFactor, e.clientX, e.clientY);
            }
            // 通常のスクロール時はブラウザの標準ページスクロールを妨げない
        }, { passive: false });
    },

    /**
     * 指定の中心点と倍率でズーム
     * @param {number} factor 
     * @param {number} [clientX] 
     * @param {number} [clientY] 
     */
    zoom(factor, clientX, clientY) {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = (clientX !== undefined) ? (clientX - rect.left) : (this.canvas.width / 2);
        const mouseY = (clientY !== undefined) ? (clientY - rect.top) : (this.canvas.height / 2);

        const newScale = Math.max(0.3, Math.min(3.5, this.scale * factor));
        if (Math.abs(newScale - this.scale) < 0.001) return;

        this.panX = mouseX - (mouseX - this.panX) * (newScale / this.scale);
        this.panY = mouseY - (mouseY - this.panY) * (newScale / this.scale);
        this.scale = newScale;
        this.renderFrame();
    },

    zoomIn() {
        this.zoom(1.2);
    },

    zoomOut() {
        this.zoom(0.8333);
    },

    resetZoom() {
        const width = this.canvas ? this.canvas.width : 800;
        const height = this.canvas ? this.canvas.height : 600;
        if (this.networkMode === 'attr') {
            this.scale = this.spacingMode === 'widest' ? 0.88 : (this.spacingMode === 'wide' ? 0.95 : 1.0);
        } else {
            this.scale = this.spacingMode === 'widest' ? 0.75 : (this.spacingMode === 'wide' ? 0.85 : 0.95);
        }
        this.panX = (width * (1 - this.scale)) / 2;
        this.panY = (height * (1 - this.scale)) / 2;
        this.renderFrame();
    },

    findNodeAt(x, y) {
        for (let i = this.nodes.length - 1; i >= 0; i--) {
            const n = this.nodes[i];
            if (n.isAttrNode) {
                const w = n.boxWidth || 80;
                const h = n.boxHeight || 34;
                if (x >= n.x - w / 2 && x <= n.x + w / 2 && y >= n.y - h / 2 && y <= n.y + h / 2) {
                    return n;
                }
            } else {
                const dx = n.x - x;
                const dy = n.y - y;
                if (dx * dx + dy * dy <= (n.radius + 4) * (n.radius + 4)) {
                    return n;
                }
            }
        }
        return null;
    },

    /**
     * 共起ネットワークを構築・描画開始
    /**
     * ノードがターゲットキーワード（またはその代表複合語・派生語）かどうか判定
     * @param {string} id 
     * @returns {boolean}
     */
    isTargetNode(id) {
        if (!id) return false;
        const idLower = id.toLowerCase();
        const tKeywords = (this.targetKeywords && this.targetKeywords.length > 0)
            ? this.targetKeywords
            : (this.targetKeyword ? [this.targetKeyword] : []);
        const rKeywords = (this.resolvedTargetWords && this.resolvedTargetWords.length > 0)
            ? this.resolvedTargetWords
            : (this.resolvedTargetWord ? [this.resolvedTargetWord] : []);
        const allTargets = Array.from(new Set([...tKeywords, ...rKeywords])).map(k => (k || '').toLowerCase()).filter(Boolean);

        for (const tl of allTargets) {
            if (idLower === tl) return true;
            if (idLower.includes(tl) || tl.includes(idLower)) return true;
        }
        return false;
    },

    /**
     * 共起ネットワークを描画する
     * @param {Array<{text: string, count: number}>} wordList 
     * @param {object} coocCounts - { "word1|||word2": count }
     * @param {string} targetKeyword 
     * @param {Array<string>} activeRelatedWords 
     * @param {object} options 
     */
    render(wordList, coocCounts, targetKeyword, activeRelatedWords, options = {}) {
        if (!this.canvas) return;
        if (this.animId) cancelAnimationFrame(this.animId);

        this.networkMode = 'word';
        this.isExport = options.isExport || false;
        this.targetKeyword = targetKeyword;
        this.targetKeywords = options.targetKeywords || (typeof AssociationEngine !== 'undefined' ? AssociationEngine.parseKeywords(targetKeyword) : [targetKeyword]);
        this.resolvedTargetWord = options.resolvedTargetWord || targetKeyword;
        this.resolvedTargetWords = options.resolvedTargetWords || [this.resolvedTargetWord];
        this.activeRelatedWords = activeRelatedWords || [];
        this.onWordClick = options.onWordClick;
        this.spacingMode = options.spacingMode || 'wide'; // 'normal' | 'wide' | 'widest'
        this.fontSize = options.fontSize || 'large'; // 'normal' | 'large' | 'xlarge'
        this.colorMode = options.colorMode || 'community'; // 'community' (話題グループ別) | 'role' (役割別)

        const rectW = this.canvas.clientWidth || (this.canvas.parentElement ? this.canvas.parentElement.clientWidth : 0);
        const rectH = this.canvas.clientHeight || (this.canvas.parentElement ? this.canvas.parentElement.clientHeight : 0);
        let width = rectW > 50 ? rectW : 680;
        let height = rectH > 50 ? rectH : 510;

        // 最終保存・Officeコピー仕様 (1200x900・4:3比率) と同一の縦横比を厳密に維持
        if (width / height > 4 / 3) {
            width = Math.round(height * 4 / 3);
        } else {
            height = Math.round(width * 3 / 4);
        }

        this.canvas.width = width;
        this.canvas.height = height;

        // 初期スケール（画面サイズとノード間隔設定に基づいて自動調整）
        const heightScaleFactor = height < 420 ? 0.85 : 1.0;
        const baseScale = this.spacingMode === 'widest' ? 0.75 : (this.spacingMode === 'wide' ? 0.85 : 0.95);
        this.scale = baseScale * heightScaleFactor;
        this.panX = (width * (1 - this.scale)) / 2;
        this.panY = (height * (1 - this.scale)) / 2 + 8;

        const maxWords = options.maxWords || 40;

        // キャッシュキー判定（パラメータに変更がなければ力学シミュレーション等をスキップ）
        const cacheKey = JSON.stringify({
            networkMode: 'word',
            targetKeyword: this.targetKeyword,
            resolvedTargetWord: this.resolvedTargetWord,
            maxWords: maxWords,
            spacingMode: this.spacingMode,
            fontSize: this.fontSize,
            colorMode: this.colorMode,
            wordCount: wordList ? wordList.length : 0,
            wordTop: wordList && wordList.length > 0 ? wordList.slice(0, 3).map(w => `${w.text}:${w.count}`).join(',') : '',
            activeRelated: (this.activeRelatedWords || []).slice().sort().join(','),
            width: width,
            height: height
        });

        if (!this.isExport && this.lastParamsKey === cacheKey && this.nodes && this.nodes.length > 0) {
            this.renderFrame();
            return;
        }

        const topWords = wordList.slice(0, maxWords);
        const wordSet = new Set(topWords.map(w => w.text));

        // 1. エッジ（共起ペア）の選出
        const edgeCandidates = [];
        for (const [key, count] of Object.entries(coocCounts)) {
            const [w1, w2] = key.split('|||');
            if (wordSet.has(w1) && wordSet.has(w2) && count >= 1) {
                edgeCandidates.push({ sourceId: w1, targetId: w2, weight: count });
            }
        }

        // 共起回数順にソートして上位エッジに絞る（見やすさのため最大60本程度）
        edgeCandidates.sort((a, b) => b.weight - a.weight);
        const maxEdges = Math.min(70, Math.round(maxWords * 1.8));
        const topEdges = edgeCandidates.slice(0, maxEdges);

        // エッジに含まれるノードを収集
        const connectedNodes = new Set();
        topEdges.forEach(e => {
            connectedNodes.add(e.sourceId);
            connectedNodes.add(e.targetId);
        });

        // ターゲットキーワード群および解決された代表複合語は必ずノードに含める
        const targetsToEnsure = Array.from(new Set([
            ...(this.targetKeywords || []),
            this.targetKeyword,
            this.resolvedTargetWord,
            ...(this.resolvedTargetWords || [])
        ])).filter(Boolean);

        let targetAdded = false;
        targetsToEnsure.forEach(tw => {
            if (wordSet.has(tw)) {
                connectedNodes.add(tw);
                targetAdded = true;
            }
        });
        if (!targetAdded) {
            const match = topWords.find(w => this.isTargetNode(w.text));
            if (match) {
                connectedNodes.add(match.text);
            }
        }

        // 上位関連語も優先
        for (const rw of this.activeRelatedWords) {
            if (wordSet.has(rw)) connectedNodes.add(rw);
        }

        // ノードリスト生成
        const countsMap = {};
        topWords.forEach(w => { countsMap[w.text] = w.count; });

        const maxCount = Math.max(...Array.from(connectedNodes).map(id => countsMap[id] || 1), 1);
        const minCount = Math.min(...Array.from(connectedNodes).map(id => countsMap[id] || 1), 1);
        const centerX = width / 2;
        const centerY = height / 2;

        this.nodes = Array.from(connectedNodes).map(id => {
            const cnt = countsMap[id] || 1;
            const rScale = maxCount > minCount ? (cnt - minCount) / (maxCount - minCount) : 0.5;
            const radius = 9 + rScale * 16;
            const isTarget = this.isTargetNode(id);
            return {
                id: id,
                count: cnt,
                radius: radius,
                isTarget: isTarget,
                community: id,
                communityIndex: 0,
                // ターゲットノード（中東情勢など）は中央に初期配置、他は周囲に分散
                x: isTarget ? centerX : centerX + (Math.random() - 0.5) * (width * 0.7),
                y: isTarget ? centerY : centerY + (Math.random() - 0.5) * (height * 0.7),
                vx: 0,
                vy: 0,
                fx: null,
                fy: null
            };
        });

        const nodeMap = new Map(this.nodes.map(n => [n.id, n]));
        this.edges = topEdges
            .filter(e => nodeMap.has(e.sourceId) && nodeMap.has(e.targetId))
            .map(e => ({
                source: nodeMap.get(e.sourceId),
                target: nodeMap.get(e.targetId),
                weight: e.weight
            }));

        // 2. 物理シミュレーションの実行（共起関係に基づく自然な空間配置・島形成へ高速収束）
        this.simulateLayout(160);

        // 3. 空間配置（近傍クラスタ）とトポロジー共起結合を融合した高精度コミュニティ検出
        this.detectCommunities();

        // 4. 初回描画
        this.renderFrame();

        if (!this.isExport) {
            this.lastParamsKey = cacheKey;
        }
    },

    /**
     * 属性 × 単語 ネットワーク（2部グラフ）を描画する
     * @param {Array<object>} matchedDocs - 抽出された回答文配列
     * @param {string} attrCol - 属性列名
     * @param {Array<object>} targetRows - 対象回答全件
     * @param {string} targetKeyword - 注目キーワード
     * @param {object} options
     */
    renderAttrNetwork(matchedDocs, attrCol, targetRows, targetKeyword, options = {}) {
        if (!this.canvas) return;
        if (this.animId) cancelAnimationFrame(this.animId);

        this.networkMode = 'attr';
        this.isExport = options.isExport || false;
        this.targetKeyword = targetKeyword;
        this.resolvedTargetWord = options.resolvedTargetWord || targetKeyword;
        this.onWordClick = options.onWordClick;
        this.onAttrClick = options.onAttrClick;
        this.spacingMode = options.spacingMode || 'wide';
        this.fontSize = options.fontSize || 'large';
        this.attrColName = attrCol || '属性';
        this.attrMetric = options.attrMetric || 'distinct'; // 'distinct' (特徴度・特有語重視) | 'freq' (出現頻度重視)

        const rectW = this.canvas.clientWidth || (this.canvas.parentElement ? this.canvas.parentElement.clientWidth : 0);
        const rectH = this.canvas.clientHeight || (this.canvas.parentElement ? this.canvas.parentElement.clientHeight : 0);
        let width = rectW > 50 ? rectW : 680;
        let height = rectH > 50 ? rectH : 510;

        if (width / height > 4 / 3) {
            width = Math.round(height * 4 / 3);
        } else {
            height = Math.round(width * 3 / 4);
        }

        this.canvas.width = width;
        this.canvas.height = height;

        const baseScale = this.spacingMode === 'widest' ? 0.88 : (this.spacingMode === 'wide' ? 0.95 : 1.0);
        this.scale = baseScale;
        this.panX = (width * (1 - this.scale)) / 2;
        this.panY = (height * (1 - this.scale)) / 2 + 10;

        const cacheKey = JSON.stringify({
            networkMode: 'attr',
            attrCol: this.attrColName,
            targetKeyword: this.targetKeyword,
            resolvedTargetWord: this.resolvedTargetWord,
            maxWords: options.maxWords || 40,
            spacingMode: this.spacingMode,
            fontSize: this.fontSize,
            attrMetric: this.attrMetric,
            wordsPerAttr: options.wordsPerAttr || 0,
            docCount: matchedDocs ? matchedDocs.length : 0,
            rowCount: targetRows ? targetRows.length : 0,
            width: width,
            height: height
        });

        if (!this.isExport && this.lastParamsKey === cacheKey && this.nodes && this.nodes.length > 0) {
            this.renderFrame();
            return;
        }

        if (!attrCol || !matchedDocs || matchedDocs.length === 0) {
            this.nodes = [];
            this.edges = [];
            this.renderFrame();
            return;
        }

        // 1. 各属性ごとの意見をグループ化
        const docsByAttr = {};
        matchedDocs.forEach(d => {
            const cat = d.attribute && d.attribute.trim() !== '' ? d.attribute.trim() : '（未回答・不明）';
            if (!docsByAttr[cat]) docsByAttr[cat] = [];
            docsByAttr[cat].push(d);
        });

        const attrCategories = Object.keys(docsByAttr).sort((a, b) => docsByAttr[b].length - docsByAttr[a].length);
        if (attrCategories.length === 0) {
            this.nodes = [];
            this.edges = [];
            this.renderFrame();
            return;
        }

        // 上位属性（レポート出力時は過密防止のため上位最大6属性、画面表示時は最大8属性）
        const isExport = options.isExport || false;
        const maxAttrs = isExport ? 6 : 8;
        let topAttrs = attrCategories.slice(0, maxAttrs);
        if (typeof AttributeSorter !== 'undefined' && AttributeSorter.sort) {
            topAttrs = AttributeSorter.sort(topAttrs.map(c => ({ category: c, matchedCount: (docsByAttr[c] || []).length }))).map(d => d.category);
        }

        // 2. 単語集計と上位特徴語／頻度語の選出
        const targetLower = (targetKeyword || '').toLowerCase();
        const resolvedLower = (this.resolvedTargetWord || '').toLowerCase();
        const maxWordsSetting = options.maxWords || 40;
        // 1属性あたりの単語数:
        // - options.wordsPerAttr の明示指定があれば最優先
        // - レポート出力(isExport)時は 4語 にスリム化して余白と可読性を最大化
        // - 画面表示時は 5〜6語（探索性を確保しつつ過密を防止）
        const wordsPerAttr = options.wordsPerAttr
            ? options.wordsPerAttr
            : (isExport ? 4 : Math.max(4, Math.min(6, Math.round(maxWordsSetting / 7))));

        // 各属性および全体での単語出現文書数を集計
        const wordCountsByAttr = new Map();
        const totalWordDocCounts = new Map();
        let totalDocsInAttrs = 0;

        topAttrs.forEach(cat => {
            const docs = docsByAttr[cat];
            totalDocsInAttrs += docs.length;
            const wMap = new Map();
            wordCountsByAttr.set(cat, wMap);

            docs.forEach(d => {
                const seen = new Set();
                (d.tokens || []).forEach(tok => {
                    const clean = tok.trim();
                    const cleanLower = clean.toLowerCase();
                    if (clean.length < 2) return;
                    if (cleanLower === targetLower || cleanLower === resolvedLower) return;
                    if (options.customStopWords && options.customStopWords.has(clean)) return;
                    if (!seen.has(clean)) {
                        seen.add(clean);
                        wMap.set(clean, (wMap.get(clean) || 0) + 1);
                        totalWordDocCounts.set(clean, (totalWordDocCounts.get(clean) || 0) + 1);
                    }
                });
            });
        });

        // 各属性における単語の統計量計算と選出
        const attrTopWords = new Map();
        const allCandidateWords = new Set();
        const wordGlobalAttrCount = new Map();
        const wordBestScoreMap = new Map();

        topAttrs.forEach(cat => {
            const wMap = wordCountsByAttr.get(cat) || new Map();
            const nCat = docsByAttr[cat].length;

            const wordList = Array.from(wMap.entries()).map(([w, count]) => {
                const totalCount = totalWordDocCounts.get(w) || count;
                const expected = (totalDocsInAttrs > 0) ? (nCat * (totalCount / totalDocsInAttrs)) : 0;
                const lift = expected > 0 ? (count / expected) : 1.0;

                // 調整済み残差 (Adjusted Standardized Residual: Zスコア)
                let zScore = 0;
                if (totalDocsInAttrs > 1 && expected > 0) {
                    const factorCat = Math.max(0.001, 1 - (nCat / totalDocsInAttrs));
                    const factorWord = Math.max(0.001, 1 - (totalCount / totalDocsInAttrs));
                    const se = Math.sqrt(Math.max(0.0001, expected * factorCat * factorWord));
                    zScore = (count - expected) / se;
                }

                return {
                    word: w,
                    count: count,
                    totalCount: totalCount,
                    expected: expected,
                    lift: lift,
                    zScore: zScore,
                    cat: cat
                };
            });

            let sorted = [];
            if (this.attrMetric === 'distinct') {
                // 【特徴度重視】統計的に過剰出現している単語（その属性特有の語）
                // 足切り: 属性内で2件以上出現かつ有意に過剰出現 (zScore > 0)
                let candidates = wordList.filter(item => item.count >= 2 && item.zScore > 0);
                if (candidates.length < wordsPerAttr) {
                    // 足切り緩和: 1件以上かつ偏りがある (zScore > 0 または lift > 1.0)
                    candidates = wordList.filter(item => item.count >= 1 && (item.zScore > 0 || item.lift > 1.0));
                }
                if (candidates.length === 0) {
                    candidates = wordList;
                }

                // ソート: 調整済み残差 zScore 降順（同点は出現件数降順）
                sorted = candidates.sort((a, b) => {
                    if (Math.abs(b.zScore - a.zScore) > 0.001) {
                        return b.zScore - a.zScore;
                    }
                    return b.count - a.count;
                }).slice(0, wordsPerAttr);
            } else {
                // 【頻度重視】単純出現文書数順
                sorted = wordList.sort((a, b) => b.count - a.count).slice(0, wordsPerAttr);
            }

            attrTopWords.set(cat, sorted);

            sorted.forEach(item => {
                allCandidateWords.add(item.word);
                if (!wordGlobalAttrCount.has(item.word)) {
                    wordGlobalAttrCount.set(item.word, new Set());
                }
                wordGlobalAttrCount.get(item.word).add(cat);

                // 単語の代表スコア（最も高いZ値または件数）を保持
                const existing = wordBestScoreMap.get(item.word);
                if (!existing || item.zScore > existing.zScore) {
                    wordBestScoreMap.set(item.word, item);
                }
            });
        });

        // 3. ノード生成
        const nodes = [];
        const nodeMap = new Map();
        const centerX = width / 2;
        const centerY = height / 2;

        // 属性ノードのバッジサイズを事前計測（ピル幅・高さ）
        const attrMetrics = topAttrs.map(cat => {
            const fullText = `👥 ${cat} (${docsByAttr[cat].length})`;
            let calcWidth = 100;
            if (this.ctx && this.ctx.measureText) {
                this.ctx.font = 'bold 12px sans-serif';
                calcWidth = Math.round(this.ctx.measureText(fullText).width + 32);
            } else {
                calcWidth = Math.round(fullText.length * 10 + 36);
            }
            const boxWidth = Math.max(96, Math.min(240, calcWidth));
            const boxHeight = 36;
            return { cat, boxWidth, boxHeight };
        });

        // 画面の縁（キャンバス外枠）に近い部分へ配置するためのスーパー楕円フィッティング
        // 単語ノードはすべて属性ノードの内側に配置されるため、属性ノードは外周の縁いっぱいまで押し出す
        const marginX = isExport ? 22 : 16;
        const marginY = isExport ? 22 : 16;
        const pSuper = 2.8; // スーパー楕円指数（長方形の四隅まで自然かつ広々と拡大）
        const edgeScale = this.spacingMode === 'widest' ? 0.98 : (this.spacingMode === 'wide' ? 0.96 : 0.94);

        // (1) 属性ノードの生成（外周縁に沿ってスーパー楕円上に均等配置）
        topAttrs.forEach((cat, idx) => {
            const angle = (idx / topAttrs.length) * (Math.PI * 2) - Math.PI / 2;
            const m = attrMetrics[idx];
            const maxRx = (width / 2 - m.boxWidth / 2 - marginX) * edgeScale;
            const maxRy = (height / 2 - m.boxHeight / 2 - marginY) * edgeScale;

            const cosVal = Math.cos(angle);
            const sinVal = Math.sin(angle);
            const sgnCos = cosVal >= 0 ? 1 : -1;
            const sgnSin = sinVal >= 0 ? 1 : -1;
            const cosP = sgnCos * Math.pow(Math.abs(cosVal), 2 / pSuper);
            const sinP = sgnSin * Math.pow(Math.abs(sinVal), 2 / pSuper);

            let px = centerX + maxRx * cosP;
            let py = centerY + maxRy * sinP;

            // 左上タイトルバッジおよび右上凡例との干渉回避（属性ノードがバッジ下に潜り込むのを物理的に防止）
            const titleSafeW = width * (isExport ? 0.44 : 0.38);
            const titleSafeH = height * (isExport ? 0.16 : 0.13);
            if (px - m.boxWidth / 2 < titleSafeW && py - m.boxHeight / 2 < titleSafeH) {
                if (px < width * 0.22) {
                    py = Math.max(py, titleSafeH + m.boxHeight / 2 + 10);
                } else {
                    px = Math.max(px, titleSafeW + m.boxWidth / 2 + 10);
                }
            }

            const legSafeW = width * (isExport ? 0.28 : 0.24);
            const legSafeH = height * (isExport ? 0.14 : 0.11);
            if (px + m.boxWidth / 2 > width - legSafeW && py - m.boxHeight / 2 < legSafeH) {
                if (px > width * 0.78) {
                    py = Math.max(py, legSafeH + m.boxHeight / 2 + 10);
                } else {
                    px = Math.min(px, width - legSafeW - m.boxWidth / 2 - 10);
                }
            }

            const colorObj = this.ATTR_PALETTE[idx % this.ATTR_PALETTE.length];

            const attrNode = {
                id: `attr_${cat}`,
                label: cat,
                attrCategory: cat,
                isAttrNode: true,
                docCount: docsByAttr[cat].length,
                angle: angle,
                x: px,
                y: py,
                vx: 0,
                vy: 0,
                fx: px,
                fy: py,
                radius: 28,
                boxWidth: m.boxWidth,
                boxHeight: m.boxHeight,
                color: colorObj.fill,
                strokeColor: colorObj.stroke,
                textColor: colorObj.text,
                lightColor: colorObj.light
            };

            nodes.push(attrNode);
            nodeMap.set(attrNode.id, attrNode);
        });

        // (2) 単語の分類（単一属性の固有語 vs 複数属性の共通語）
        const spacingFactor = this.spacingMode === 'widest' ? 1.25 : (this.spacingMode === 'wide' ? 1.12 : 1.0);
        const uniqueWordsByAttr = new Map();
        topAttrs.forEach(cat => uniqueWordsByAttr.set(cat, []));
        const sharedWords = [];

        allCandidateWords.forEach(word => {
            const connectedCats = Array.from(wordGlobalAttrCount.get(word) || []);
            if (connectedCats.length >= 2) {
                sharedWords.push(word);
            } else {
                const primaryCat = connectedCats[0];
                if (uniqueWordsByAttr.has(primaryCat)) {
                    uniqueWordsByAttr.get(primaryCat).push(word);
                }
            }
        });

        // (3) 単語ノードの生成とセクター初期配置
        // [A] 固有語: 親属性ノードの内側セクター（足元）に花びら状（扇形千鳥配置）に整列
        topAttrs.forEach(cat => {
            const an = nodeMap.get(`attr_${cat}`);
            const uWords = uniqueWordsByAttr.get(cat) || [];
            const count = uWords.length;
            if (count === 0) return;

            const toCenterX = centerX - an.x;
            const toCenterY = centerY - an.y;
            const distToCenter = Math.hypot(toCenterX, toCenterY) || 1;
            const dirX = toCenterX / distToCenter;
            const dirY = toCenterY / distToCenter;
            const tanX = -dirY;
            const tanY = dirX;

            const halfW = (an.boxWidth || 100) / 2;
            // 属性ピルバッジの縁から内側に適度かつ十分なクリアランス（エクスポート時は短縮して凝縮）
            const baseInward = halfW * 0.30 + (isExport ? 38 : 68) * spacingFactor;

            uWords.forEach((word, idx) => {
                const row = idx % 2; // 2列千鳥配置で縦横の広がりをバランスよく分散
                const col = Math.floor(idx / 2);
                const colCount = Math.ceil(count / 2);
                const offsetCol = (col - (colCount - 1) / 2);

                const spreadTan = offsetCol * ((isExport ? 36 : 48) * spacingFactor);
                const spreadRad = baseInward + row * ((isExport ? 34 : 46) * spacingFactor);

                const posX = an.x + dirX * spreadRad + tanX * spreadTan;
                const posY = an.y + dirY * spreadRad + tanY * spreadTan;

                const bestScore = wordBestScoreMap.get(word) || {};
                const catIdx = topAttrs.indexOf(cat);
                const primaryColor = catIdx >= 0 ? this.ATTR_PALETTE[catIdx % this.ATTR_PALETTE.length].fill : '#2563EB';

                const wordNode = {
                    id: word,
                    label: word,
                    isAttrNode: false,
                    isShared: false,
                    connectedCats: [cat],
                    primaryCat: cat,
                    scoreInfo: bestScore,
                    count: bestScore.count || 1,
                    zScore: bestScore.zScore || 0,
                    homeX: posX,
                    homeY: posY,
                    x: posX,
                    y: posY,
                    vx: 0,
                    vy: 0,
                    fx: null,
                    fy: null,
                    radius: 14,
                    color: primaryColor,
                    strokeColor: '#FFFFFF',
                    textColor: '#1E293B'
                };
                nodes.push(wordNode);
                nodeMap.set(wordNode.id, wordNode);
            });
        });

        // [B] 共通語: 接続属性の重心とキャンバス中心の間にゆったり配置
        sharedWords.forEach((word, idx) => {
            const connectedCats = Array.from(wordGlobalAttrCount.get(word) || []);
            let sumX = 0, sumY = 0;
            connectedCats.forEach(c => {
                const an = nodeMap.get(`attr_${c}`);
                if (an) { sumX += an.x; sumY += an.y; }
            });
            const meanX = sumX / connectedCats.length;
            const meanY = sumY / connectedCats.length;

            const isSuperShared = connectedCats.length >= 3;
            const centerWeight = isSuperShared ? 0.75 : 0.45;
            const posX = meanX * (1 - centerWeight) + centerX * centerWeight + (idx % 2 === 0 ? 16 : -16);
            const posY = meanY * (1 - centerWeight) + centerY * centerWeight + (idx % 3 === 0 ? 16 : -16);

            const bestScore = wordBestScoreMap.get(word) || {};
            const primaryCat = connectedCats[0];

            const wordNode = {
                id: word,
                label: word,
                isAttrNode: false,
                isShared: true,
                connectedCats: connectedCats,
                primaryCat: primaryCat,
                scoreInfo: bestScore,
                count: bestScore.count || 1,
                zScore: bestScore.zScore || 0,
                homeX: posX,
                homeY: posY,
                x: posX,
                y: posY,
                vx: 0,
                vy: 0,
                fx: null,
                fy: null,
                radius: 18,
                color: '#4F46E5',
                strokeColor: '#FFFFFF',
                textColor: '#312E81'
            };
            nodes.push(wordNode);
            nodeMap.set(wordNode.id, wordNode);
        });

        // 4. エッジ生成
        const edges = [];
        topAttrs.forEach(cat => {
            const attrNode = nodeMap.get(`attr_${cat}`);
            const topWords = attrTopWords.get(cat) || [];

            topWords.forEach(item => {
                const wordNode = nodeMap.get(item.word);
                if (attrNode && wordNode) {
                    // 特徴度重視の場合はZスコアに応じた線の強さ、頻度重視の場合は出現数に応じた強さ
                    const edgeWeight = (this.attrMetric === 'distinct')
                        ? Math.max(1, Math.min(10, Math.round(Math.max(1, item.zScore * 2))))
                        : item.count;

                    edges.push({
                        source: attrNode,
                        target: wordNode,
                        weight: edgeWeight,
                        rawCount: item.count,
                        zScore: item.zScore,
                        color: attrNode.color
                    });
                }
            });
        });

        this.nodes = nodes;
        this.edges = edges;

        // 5. 属性ネットワーク用レイアウト物理シミュレーション
        this.simulateAttrLayout(220);

        // 6. 初回描画
        this.renderFrame();

        if (!this.isExport) {
            this.lastParamsKey = cacheKey;
        }
    },

    /**
     * 属性×単語ネットワーク用物理シミュレーション
     * 属性ノード（ピル型カプセル）と単語ノード、および単語ノード同士の間隔を十分に広げて
     * ラベルの重なりを物理的に防止する
     */
    simulateAttrLayout(iterations = 220) {
        if (!this.nodes || this.nodes.length === 0) return;
        const width = this.canvas.width;
        const height = this.canvas.height;
        const centerX = width / 2;
        const centerY = height / 2;

        const isExp = this.isExport || false;
        const spacingFactor = this.spacingMode === 'widest' ? 1.25 : (this.spacingMode === 'wide' ? 1.12 : 1.0);

        const attrNodes = this.nodes.filter(n => n.isAttrNode);
        const wordNodes = this.nodes.filter(n => !n.isAttrNode);

        // タイトルバッジおよび凡例領域の不可侵境界（低背スリム化に合わせて最適化）
        const titleSafeW = width * (isExp ? 0.48 : 0.40);
        const titleSafeH = height * (isExp ? 0.08 : 0.06);
        const legSafeW = width * (isExp ? 0.30 : 0.25);
        const legSafeH = height * (isExp ? 0.08 : 0.06);

        for (let iter = 0; iter < iterations; iter++) {
            const alpha = 1.0 - (iter / iterations);

            // 1. ホームポジション（扇形セクター）保持引力
            // 固有語が親属性のセクター外（特に中央や他の属性）へ流出・密集するのを強力に防止
            for (const wn of wordNodes) {
                if (!wn.isShared && wn.homeX !== undefined) {
                    const hdx = wn.homeX - wn.x;
                    const hdy = wn.homeY - wn.y;
                    wn.vx += hdx * 0.09 * alpha;
                    wn.vy += hdy * 0.09 * alpha;
                } else if (wn.isShared && wn.homeX !== undefined) {
                    // 共通語も中央付近の適正位置を保持
                    const hdx = wn.homeX - wn.x;
                    const hdy = wn.homeY - wn.y;
                    wn.vx += hdx * 0.04 * alpha;
                    wn.vy += hdy * 0.04 * alpha;
                }
            }

            // 2. 単語ノード同士のテキスト重なり防止（安全クランプ付き反発で四隅への爆発的吹き飛びを防止）
            const minDistX = (isExp ? 58 : 80) * spacingFactor;
            const minDistY = (isExp ? 38 : 52) * spacingFactor;

            for (let i = 0; i < wordNodes.length; i++) {
                const w1 = wordNodes[i];
                for (let j = i + 1; j < wordNodes.length; j++) {
                    const w2 = wordNodes[j];
                    const dx = w2.x - w1.x;
                    const dy = w2.y - w1.y;

                    const normDistSq = (dx * dx) / (minDistX * minDistX) + (dy * dy) / (minDistY * minDistY);
                    if (normDistSq < 1.0) {
                        const normDist = Math.max(0.12, Math.sqrt(normDistSq));
                        // 反発力に安全クランプを設けて安定化
                        const repMagnitude = Math.min(10.0, ((1.0 - normDist) / normDist) * 8.5) * alpha;
                        const fx = (dx / (minDistX * normDist)) * repMagnitude * 30;
                        const fy = (dy / (minDistY * normDist)) * repMagnitude * 30;

                        w1.vx -= fx;
                        w1.vy -= fy;
                        w2.vx += fx;
                        w2.vy += fy;
                    }
                }
            }

            // 3. 属性ピルバッジ（角丸長方形）との不可侵・内側安全マージン押し出し
            for (const wn of wordNodes) {
                for (const an of attrNodes) {
                    const dx = wn.x - an.x;
                    const dy = wn.y - an.y;

                    const safeW = (an.boxWidth / 2) + (wn.radius || 14) + (isExp ? 34 : 48);
                    const safeH = (an.boxHeight / 2) + (wn.radius || 14) + (isExp ? 34 : 48);

                    const absX = Math.abs(dx);
                    const absY = Math.abs(dy);

                    if (absX < safeW && absY < safeH) {
                        // 属性ノードからキャンバス中心へ向かう方向
                        const toCenterX = centerX - an.x;
                        const toCenterY = centerY - an.y;
                        const distC = Math.hypot(toCenterX, toCenterY) || 1;
                        const dirX = toCenterX / distC;
                        const dirY = toCenterY / distC;

                        const overlap = Math.max(safeW - absX, safeH - absY);
                        wn.vx += dirX * overlap * 0.35 * alpha;
                        wn.vy += dirY * overlap * 0.35 * alpha;
                        wn.x += dirX * overlap * 0.30;
                        wn.y += dirY * overlap * 0.30;
                    }
                }
            }

            // 3.5. タイトルバッジおよび凡例領域に対する不可侵押し出し（単語がバッジの下に潜り込むのを防止）
            for (const wn of wordNodes) {
                // 左上タイトルバッジ回避
                if (wn.x < titleSafeW + 16 && wn.y < titleSafeH + 16) {
                    const penX = Math.max(0, titleSafeW + 16 - wn.x);
                    const penY = Math.max(0, titleSafeH + 16 - wn.y);
                    wn.vx += penX * 0.16 * alpha;
                    wn.vy += penY * 0.16 * alpha;
                    wn.x += penX * 0.14;
                    wn.y += penY * 0.14;
                }
                // 右上凡例回避
                if (wn.x > width - legSafeW - 16 && wn.y < legSafeH + 16) {
                    const penX = Math.max(0, wn.x - (width - legSafeW - 16));
                    const penY = Math.max(0, legSafeH + 16 - wn.y);
                    wn.vx -= penX * 0.16 * alpha;
                    wn.vy += penY * 0.16 * alpha;
                    wn.x -= penX * 0.14;
                    wn.y += penY * 0.14;
                }
            }

            // 4. バネの力（エッジ引力）
            // レポート出力時はエッジ目標長を短縮して小さなカードでも引き締まるよう最適化
            for (const edge of this.edges) {
                const s = edge.source; // 属性ノード
                const t = edge.target; // 単語ノード
                const dx = t.x - s.x;
                const dy = t.y - s.y;
                const dist = Math.hypot(dx, dy) || 1;

                const baseWordClearance = (s.boxWidth / 2) + (isExp ? 36 : 55);
                const targetLen = t.isShared
                    ? ((isExp ? 135 : 230) * spacingFactor)
                    : (Math.max(baseWordClearance, s.boxWidth * 0.30 + (isExp ? 46 : 82)) * spacingFactor);
                const springForce = (dist - targetLen) * (t.isShared ? (isExp ? 0.07 : 0.05) : 0.04) * alpha;

                t.vx -= (dx / dist) * springForce;
                t.vy -= (dy / dist) * springForce;
            }

            // 5. 速度減衰と位置更新、画面内安全クランプ
            const pad = 18;
            for (const wn of wordNodes) {
                wn.vx *= 0.65;
                wn.vy *= 0.65;
                wn.x += wn.vx;
                wn.y += wn.vy;

                wn.x = Math.max(pad, Math.min(width - pad, wn.x));
                wn.y = Math.max(pad, Math.min(height - pad, wn.y));
            }
        }
    },

    /**
     * 話題グループ（コミュニティ）の判定
     * 単純なラベル伝播ではなく、物理シミュレーションによる空間的近接性と
     * 単語間の共起エッジ重みを融合した凝集型階層クラスタリング（Agglomerative Hierarchical Clustering）
     */
    detectCommunities() {
        if (!this.nodes || this.nodes.length === 0) return;

        // ターゲットノード（注目語）と一般ノードを分離
        const nonTargetNodes = this.nodes.filter(n => !n.isTarget);
        const N = nonTargetNodes.length;
        if (N === 0) {
            this.communityThemes = [];
            return;
        }

        // ノード数に応じた最適な話題グループ数 k (3〜5)
        let k = 3;
        if (N >= 29) k = 5;
        else if (N >= 15) k = 4;
        k = Math.min(k, N);

        // エッジ重みマップの構築
        const edgeMap = new Map();
        this.edges.forEach(e => {
            edgeMap.set(`${e.source.id}|||${e.target.id}`, e.weight);
            edgeMap.set(`${e.target.id}|||${e.source.id}`, e.weight);
        });

        // 画面座標のスパンを計算（正規化用）
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        nonTargetNodes.forEach(n => {
            if (n.x < minX) minX = n.x;
            if (n.x > maxX) maxX = n.x;
            if (n.y < minY) minY = n.y;
            if (n.y > maxY) maxY = n.y;
        });
        const maxSpan = Math.max(10, Math.hypot(maxX - minX, maxY - minY));

        // 各ノードを独立した初期クラスタにする
        let clusters = nonTargetNodes.map((n, i) => ({
            id: i,
            nodes: [n],
            cx: n.x,
            cy: n.y
        }));

        // クラスタ間距離の計算関数 (空間的セントロイド距離 × 共起結合ボーナス)
        const calcClusterDist = (c1, c2) => {
            const spatialDist = Math.hypot(c1.cx - c2.cx, c1.cy - c2.cy) / maxSpan;
            let totalWeight = 0;
            let pairCount = 0;
            c1.nodes.forEach(n1 => {
                c2.nodes.forEach(n2 => {
                    const w = edgeMap.get(`${n1.id}|||${n2.id}`) || 0;
                    totalWeight += w;
                    pairCount++;
                });
            });
            const avgWeight = pairCount > 0 ? totalWeight / pairCount : 0;
            // エッジで結ばれている場合は距離を最大0.5割引
            const coocDiscount = Math.max(0.4, 1.0 - Math.min(0.6, avgWeight * 0.06));
            return spatialDist * coocDiscount;
        };

        // 目標クラスタ数 k になるまで最も距離の近いクラスタを逐次統合
        while (clusters.length > k) {
            let minDist = Infinity;
            let mergeI = 0, mergeJ = 1;

            for (let i = 0; i < clusters.length; i++) {
                for (let j = i + 1; j < clusters.length; j++) {
                    const d = calcClusterDist(clusters[i], clusters[j]);
                    if (d < minDist) {
                        minDist = d;
                        mergeI = i;
                        mergeJ = j;
                    }
                }
            }

            const cA = clusters[mergeI];
            const cB = clusters[mergeJ];
            const mergedNodes = [...cA.nodes, ...cB.nodes];
            const avgX = mergedNodes.reduce((s, n) => s + n.x, 0) / mergedNodes.length;
            const avgY = mergedNodes.reduce((s, n) => s + n.y, 0) / mergedNodes.length;

            clusters.splice(mergeJ, 1);
            clusters[mergeI] = {
                id: cA.id,
                nodes: mergedNodes,
                cx: avgX,
                cy: avgY
            };
        }

        // 視覚的調和のため、画面中心からの角度順（時計回り）にクラスタをソート
        const centerX = this.canvas.width / 2;
        const centerY = this.canvas.height / 2;
        clusters.sort((a, b) => {
            const angleA = Math.atan2(a.cy - centerY, a.cx - centerX);
            const angleB = Math.atan2(b.cy - centerY, b.cx - centerX);
            return angleA - angleB;
        });

        // 各ノードへ communityIndex とコミュニティIDを反映
        clusters.forEach((c, idx) => {
            c.nodes.forEach(n => {
                n.communityIndex = idx;
                n.community = `c_${idx}`;
            });
        });

        // ターゲットノードは独立した中心（communityIndex = -1）
        this.nodes.forEach(n => {
            if (n.isTarget) {
                n.communityIndex = -1;
                n.community = 'target';
            }
        });

        // 各話題グループのテーマ名・代表語を保存（凡例・ツールチップ用）
        this.communityThemes = clusters.map((c, idx) => {
            const sortedWords = [...c.nodes].sort((a, b) => (b.count || 0) - (a.count || 0));
            const topWords = sortedWords.slice(0, 2).map(n => n.id);
            return {
                index: idx,
                name: `グループ ${idx + 1}`,
                label: topWords.join('・') || `グループ ${idx + 1}`,
                count: c.nodes.length,
                members: c.nodes
            };
        });
    },

    simulateLayout(steps) {
        const width = this.canvas.width;
        const height = this.canvas.height;
        const centerX = width / 2;
        const centerY = height / 2;

        const isExp = this.isExport || false;

        // 間隔設定に基づく物理定数（レポート出力時は小さな領域でも引き締まるよう短縮設定）
        const spacingParams = {
            normal: {
                baseLen: isExp ? 72 : 120,
                kRepel: isExp ? 5200 : 8000,
                minPadding: isExp ? 24 : 35,
                gravity: isExp ? 0.008 : 0.005
            },
            wide: {
                baseLen: isExp ? 88 : 175,
                kRepel: isExp ? 8200 : 16000,
                minPadding: isExp ? 32 : 50,
                gravity: isExp ? 0.006 : 0.003
            },
            widest: {
                baseLen: isExp ? 115 : 240,
                kRepel: isExp ? 12500 : 26000,
                minPadding: isExp ? 42 : 70,
                gravity: isExp ? 0.004 : 0.002
            }
        };
        const p = spacingParams[this.spacingMode] || spacingParams.wide;

        // タイトルバッジおよび凡例領域の不可侵安全境界（低背スリム化に合わせて最適化）
        const hasTitle = !!this.targetKeyword;
        const titleSafeW = hasTitle ? (width * (isExp ? 0.45 : 0.38)) : 0;
        const titleSafeH = hasTitle ? (height * (isExp ? 0.08 : 0.06)) : 0;
        const legendSafeW = width * (isExp ? 0.60 : 0.55);
        const legendSafeH = height * (isExp ? 0.08 : 0.06);
        const legendSafeY = height - legendSafeH;

        for (let s = 0; s < steps; s++) {
            // 1. 反発力 (Repulsion) - 距離の2乗反比例
            for (let i = 0; i < this.nodes.length; i++) {
                const n1 = this.nodes[i];
                for (let j = i + 1; j < this.nodes.length; j++) {
                    const n2 = this.nodes[j];
                    let dx = n2.x - n1.x;
                    let dy = n2.y - n1.y;
                    if (dx === 0 && dy === 0) {
                        dx = (Math.random() - 0.5) * 5;
                        dy = (Math.random() - 0.5) * 5;
                    }
                    const distSq = dx * dx + dy * dy + 15;
                    const dist = Math.sqrt(distSq);
                    const force = p.kRepel / distSq;
                    const fx = (dx / dist) * force;
                    const fy = (dy / dist) * force;
                    n1.vx -= fx;
                    n1.vy -= fy;
                    n2.vx += fx;
                    n2.vy += fy;
                }
            }

            // 2. 引力 (Spring Attraction) - エッジ接続
            const springK = isExp ? 0.045 : 0.035;
            this.edges.forEach(e => {
                let dx = e.target.x - e.source.x;
                let dy = e.target.y - e.source.y;
                if (dx === 0 && dy === 0) {
                    dx = (Math.random() - 0.5) * 5;
                    dy = (Math.random() - 0.5) * 5;
                }
                const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                const force = (dist - p.baseLen) * springK * Math.min(2.5, 1 + 0.15 * e.weight);
                const fx = (dx / dist) * force;
                const fy = (dy / dist) * force;
                e.source.vx += fx;
                e.source.vy += fy;
                e.target.vx -= fx;
                e.target.vy -= fy;
            });

            // 3. 中心重力 (Center Gravity) & 速度更新
            this.nodes.forEach(n => {
                // ターゲットノードを中心へ強固に引き寄せて中心に安定化
                const g = n.isTarget ? p.gravity * 4.0 : p.gravity;
                n.vx += (centerX - n.x) * g;
                n.vy += (centerY - n.y) * g;

                // 左上タイトルバッジとの干渉回避押し出し
                if (hasTitle && n.x < titleSafeW + n.radius && n.y < titleSafeH + n.radius) {
                    const penX = Math.max(0, titleSafeW + n.radius - n.x);
                    const penY = Math.max(0, titleSafeH + n.radius - n.y);
                    n.vx += penX * 0.12;
                    n.vy += penY * 0.12;
                    if (n.fx == null) {
                        n.x += penX * 0.14;
                        n.y += penY * 0.14;
                    }
                }

                // 左下凡例との干渉回避押し出し
                if (n.x < legendSafeW + n.radius && n.y > legendSafeY - n.radius) {
                    const penX = Math.max(0, legendSafeW + n.radius - n.x);
                    const penY = Math.max(0, n.y - (legendSafeY - n.radius));
                    n.vx += penX * 0.08;
                    n.vy -= penY * 0.08;
                    if (n.fx == null) {
                        n.x += penX * 0.10;
                        n.y -= penY * 0.10;
                    }
                }

                // 速度減衰 (Damping)
                n.vx *= 0.85;
                n.vy *= 0.85;

                if (n.fx == null) n.x += n.vx;
                if (n.fy == null) n.y += n.vy;

                // 画面外への飛び出し防止
                n.x = Math.max(n.radius + 20, Math.min(width - n.radius - 20, n.x));
                n.y = Math.max(n.radius + 20, Math.min(height - n.radius - 20, n.y));
            });

            // 4. ハード衝突防止（Collision Resolution / 重なり完全解消）
            for (let i = 0; i < this.nodes.length; i++) {
                const n1 = this.nodes[i];
                for (let j = i + 1; j < this.nodes.length; j++) {
                    const n2 = this.nodes[j];
                    let dx = n2.x - n1.x;
                    let dy = n2.y - n1.y;
                    let dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
                    const minDist = n1.radius + n2.radius + p.minPadding;
                    if (dist < minDist) {
                        const overlap = (minDist - dist) * 0.5;
                        const ox = (dx / dist) * overlap;
                        const oy = (dy / dist) * overlap;
                        if (n1.fx == null) { n1.x -= ox; n1.y -= oy; }
                        if (n2.fx == null) { n2.x += ox; n2.y += oy; }
                    }
                }
            }
        }
    },

    renderFrame() {
        if (!this.ctx || !this.canvas) return;
        this.renderToContext(this.ctx, this.canvas.width, this.canvas.height, this.scale, this.panX, this.panY, false);
    },

    /**
     * 指定のコンテキストに共起ネットワークを描画
     */
    renderToContext(ctx, w, h, scale, panX, panY, isExport = false) {
        if (!isExport) {
            ctx.clearRect(0, 0, w, h);
        } else {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, w, h);
        }

        // 属性×単語ネットワークモードの場合の描画分岐
        if (this.networkMode === 'attr') {
            this.renderAttrToContext(ctx, w, h, scale, panX, panY, isExport);
            return;
        }

        if (this.nodes.length === 0) {
            ctx.fillStyle = '#64748b';
            ctx.font = '14px "Noto Sans JP", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('表示可能な共起データがありません（共起ペアが不足しているか、頻度条件を満たしていません）', w / 2, h / 2);
            return;
        }

        ctx.save();
        ctx.translate(panX, panY);
        ctx.scale(scale, scale);

        // 関連語セット
        const relatedSet = new Set(this.activeRelatedWords.map(w => w.toLowerCase()));

        // 1. エッジ描画
        const maxWeight = Math.max(...this.edges.map(e => e.weight), 1);
        const palette = [
            '#10b981', // エメラルドグリーン (グループ1)
            '#f59e0b', // アンバーオレンジ (グループ2)
            '#8b5cf6', // バイオレットパープル (グループ3)
            '#06b6d4', // シアン (グループ4)
            '#ec4899', // ローズピンク (グループ5)
            '#3b82f6', // コバルトブルー (グループ6)
            '#f97316', // サンセットオレンジ (グループ7)
            '#14b8a6', // ティール (グループ8)
            '#64748b'  // スレートグレー (グループ9)
        ];

        // エッジを「キーワード直結（第1次共起）」と「関連語同士（第2次共起）」に分離
        const directEdges = [];
        const subEdges = [];
        this.edges.forEach(e => {
            const isDirect = this.isTargetNode(e.source.id) || this.isTargetNode(e.target.id);
            if (isDirect) directEdges.push(e);
            else subEdges.push(e);
        });

        // (1) 関連語同士のエッジ描画（細めの破線・背景の文脈メッシュとして描画）
        subEdges.forEach(e => {
            const isConnectedToHover = !isExport && this.hoverNode && (e.source.id === this.hoverNode.id || e.target.id === this.hoverNode.id);
            const isSameCommunity = this.colorMode === 'community' && e.source.communityIndex >= 0 && e.source.communityIndex === e.target.communityIndex;

            const alpha = (!isExport && this.hoverNode)
                ? (isConnectedToHover ? 0.88 : 0.04)
                : (isSameCommunity ? 0.32 + (e.weight / maxWeight) * 0.35 : 0.16 + (e.weight / maxWeight) * 0.25);

            const lineWidth = (!isExport && this.hoverNode && isConnectedToHover)
                ? Math.min(3.2, 1.4 + (e.weight / maxWeight) * 2.5)
                : (isSameCommunity ? Math.min(2.0, 0.8 + (e.weight / maxWeight) * 1.4) : Math.min(1.4, 0.6 + (e.weight / maxWeight) * 1.0));

            if (!isExport && isConnectedToHover) {
                ctx.strokeStyle = '#3b82f6';
                ctx.setLineDash([5, 3]);
            } else if (isSameCommunity) {
                ctx.strokeStyle = palette[e.source.communityIndex % palette.length];
                ctx.setLineDash([4, 3]);
            } else {
                ctx.strokeStyle = `rgba(148, 163, 184, ${alpha})`;
                ctx.setLineDash([3, 3]);
            }

            ctx.globalAlpha = (!isExport && isConnectedToHover) ? 1.0 : alpha;
            ctx.lineWidth = lineWidth;
            ctx.beginPath();
            ctx.moveTo(e.source.x, e.source.y);
            ctx.lineTo(e.target.x, e.target.y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 1.0;
        });

        // (2) キーワード直結エッジ描画（太めの実線・手前に描画して主軸・幹を強力に強調）
        directEdges.forEach(e => {
            const isConnectedToHover = !isExport && this.hoverNode && (e.source.id === this.hoverNode.id || e.target.id === this.hoverNode.id);

            const alpha = (!isExport && this.hoverNode)
                ? (isConnectedToHover ? 1.0 : 0.08)
                : 0.55 + (e.weight / maxWeight) * 0.40;

            const lineWidth = (!isExport && this.hoverNode && isConnectedToHover)
                ? Math.min(5.5, 2.8 + (e.weight / maxWeight) * 3.8)
                : Math.min(4.2, 1.8 + (e.weight / maxWeight) * 2.6);

            ctx.setLineDash([]); // 実線
            if (!isExport && isConnectedToHover) {
                ctx.strokeStyle = '#2563eb';
            } else {
                ctx.strokeStyle = '#2563eb';
            }

            ctx.globalAlpha = (!isExport && isConnectedToHover) ? 1.0 : alpha;
            ctx.lineWidth = lineWidth;
            ctx.beginPath();
            ctx.moveTo(e.source.x, e.source.y);
            ctx.lineTo(e.target.x, e.target.y);
            ctx.stroke();
            ctx.globalAlpha = 1.0;
        });

        // 2. ノード描画
        // 【描画レイヤーの分離（白い傷の解消）】
        // 各ノードごとに「円を描いた直後にテキスト」を描画すると、文字（特に「学」「高」等の上部に点やツ冠がある漢字）の
        // 白フチ（strokeText）が円の下端に食い込み、「白い傷・切り欠き」が発生してしまいます。
        // また、近接ノードの文字の白フチが他のノードの円を侵食するのを防ぐため、
        // 「全テキストラベル描画」→「全ノード円・強調リング描画」の順で2層描画します。

        const fontSizes = {
            normal: { target: 15, related: 13, other: 12 },
            large:   { target: 17, related: 15, other: 14 },
            xlarge:  { target: 20, related: 18, other: 16 }
        };
        const fCfg = fontSizes[this.fontSize] || fontSizes.large;

        // (1) 第1層: 全ノードのテキストラベルを描画
        this.nodes.forEach(node => {
            const isTarget = this.isTargetNode(node.id);
            const isRelated = relatedSet.has(node.id.toLowerCase());
            const baseFSize = isTarget ? fCfg.target : (isRelated ? fCfg.related : fCfg.other);
            // エクスポート（印刷・レポート）時は縮小表示でもクッキリ読めるよう文字サイズを拡大
            const fSize = isExport ? Math.round(baseFSize * 1.6) : baseFSize;

            ctx.font = `bold ${fSize}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';

            const textMargin = Math.max(6, Math.round(fSize * 0.38));
            const nodeRadius = isExport ? (node.radius * 1.25) : node.radius;
            const textY = node.y + nodeRadius + textMargin;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = Math.max(4, Math.round(fSize * (isExport ? 0.38 : 0.32)));
            ctx.strokeText(node.id, node.x, textY);
            ctx.fillStyle = isTarget ? '#9f1239' : (isRelated ? '#0369a1' : '#1e293b');
            ctx.fillText(node.id, node.x, textY);
        });

        // (2) 第2層: 全ノード本体の円・リングを描画（上層レイヤーとして描くことで、文字の白フチによる傷や欠けを完全解消）
        this.nodes.forEach(node => {
            const isTarget = this.isTargetNode(node.id);
            const isRelated = relatedSet.has(node.id.toLowerCase());

            let fillColor;
            let strokeColor = '#ffffff';
            let strokeWidth = 2;

            if (this.colorMode === 'role') {
                // 役割別モード: ターゲット(赤)、関連語(青)、その他共起語(緑)
                if (isTarget) {
                    fillColor = '#e11d48'; // ターゲット: ローズレッド
                    strokeColor = '#ffe4e6';
                    strokeWidth = 3.5;
                } else if (isRelated) {
                    fillColor = '#0284c7'; // 関連語: スカイブルー
                    strokeColor = '#e0f2fe';
                    strokeWidth = 2.5;
                } else {
                    fillColor = '#10b981'; // その他: グリーン
                    strokeColor = '#ffffff';
                    strokeWidth = 2;
                }
            } else {
                // 話題グループ（コミュニティ）別モード (推奨・デフォルト)
                if (isTarget) {
                    fillColor = '#e11d48'; // ターゲット語は赤色で不動の中心
                    strokeColor = '#ffe4e6';
                    strokeWidth = 3.5;
                } else {
                    // 単語間の結びつき（コミュニティ）に基づく多彩な色分け
                    const cIdx = node.communityIndex >= 0 ? node.communityIndex : 0;
                    fillColor = palette[cIdx % palette.length];
                    if (isRelated) {
                        strokeColor = '#0284c7'; // 関連語チップの語はブルーの外枠で役割を明示
                        strokeWidth = 3;
                    }
                }
            }

            // 円
            ctx.beginPath();
            ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
            ctx.fillStyle = fillColor;
            ctx.fill();
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = strokeWidth;
            ctx.stroke();

            // ターゲットキーワードの場合は強調外周リング
            if (isTarget) {
                ctx.beginPath();
                ctx.arc(node.x, node.y, node.radius + 4, 0, Math.PI * 2);
                ctx.strokeStyle = '#f43f5e';
                ctx.lineWidth = 1.8;
                ctx.stroke();
            } else if (this.colorMode === 'community' && isRelated) {
                // コミュニティモード時、チェックされた関連語には外周にアクセントリングを描画
                ctx.beginPath();
                ctx.arc(node.x, node.y, node.radius + 3.5, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(2, 132, 199, 0.7)';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
        });

        ctx.restore();

        // 3. ホバーノードの詳細ツールチップ（画面固定スケールで描画）
        if (!isExport && this.hoverNode) {
            const hn = this.hoverNode;
            let groupLabel = '';
            if (hn.isTarget) {
                groupLabel = '注目キーワード (中心語)';
            } else if (this.communityThemes && this.communityThemes[hn.communityIndex]) {
                groupLabel = `話題: ${this.communityThemes[hn.communityIndex].label}`;
            } else {
                groupLabel = `グループ ${(hn.communityIndex || 0) + 1}`;
            }

            const tipText = `${hn.id} (出現: ${hn.count}回 / ${groupLabel})`;
            ctx.font = 'bold 12px sans-serif';
            const metrics = ctx.measureText(tipText);
            const tipW = metrics.width + 16;
            const tipH = 26;
            const screenX = hn.x * scale + panX;
            const screenY = hn.y * scale + panY;
            const tipR = hn.radius * scale;
            const tipX = Math.max(10, Math.min(w - tipW - 10, screenX - tipW / 2));
            const tipY = Math.max(10, screenY - tipR - 32);

            ctx.save();
            ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect ? ctx.roundRect(tipX, tipY, tipW, tipH, 5) : ctx.rect(tipX, tipY, tipW, tipH);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(tipText, tipX + tipW / 2, tipY + tipH / 2);
            ctx.restore();
        }

        this.drawLegend(ctx, w, h, isExport);
    },

    /**
     * 属性 × 単語 ネットワーク（2部グラフ）の描画処理
     */
    renderAttrToContext(ctx, w, h, scale, panX, panY, isExport = false) {
        if (!isExport) {
            ctx.clearRect(0, 0, w, h);
        } else {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, w, h);
        }

        if (this.nodes.length === 0) {
            ctx.fillStyle = '#64748b';
            ctx.font = '14px "Noto Sans JP", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('📊 属性列が設定されていないか、集計可能な意見データがありません', w / 2, h / 2);
            return;
        }

        ctx.save();
        ctx.translate(panX, panY);
        ctx.scale(scale, scale);

        // 1. エッジ描画
        const maxWeight = Math.max(...this.edges.map(e => e.weight), 1);
        const edgeScale = isExport ? 1.5 : 1.0;

        this.edges.forEach(e => {
            const isConnectedToHover = !isExport && this.hoverNode &&
                (e.source.id === this.hoverNode.id || e.target.id === this.hoverNode.id);

            const alpha = (!isExport && this.hoverNode)
                ? (isConnectedToHover ? 0.95 : 0.05)
                : 0.35 + (e.weight / maxWeight) * 0.40;

            const baseLineWidth = (!isExport && this.hoverNode && isConnectedToHover)
                ? Math.min(5.0, 2.0 + (e.weight / maxWeight) * 3.5)
                : Math.min(3.2, 1.2 + (e.weight / maxWeight) * 2.0);
            const lineWidth = baseLineWidth * edgeScale;

            ctx.globalAlpha = alpha;
            ctx.lineWidth = lineWidth;
            ctx.strokeStyle = isConnectedToHover ? '#2563EB' : (e.color || '#3B82F6');
            ctx.beginPath();
            ctx.moveTo(e.source.x, e.source.y);
            ctx.lineTo(e.target.x, e.target.y);
            ctx.stroke();
            ctx.globalAlpha = 1.0;
        });

        // 2. 属性ノード（第2層: 背景側のピル型カプセルバッジ）
        // 単語ノードやその文字を覆い隠さないよう、エッジの直後・単語ノードの手前に描画
        this.nodes.filter(n => n.isAttrNode).forEach(node => {
            const isHover = !isExport && this.hoverNode && this.hoverNode.id === node.id;
            const badgeScale = isExport ? 1.45 : 1.0;
            const wBox = (node.boxWidth || 100) * badgeScale;
            const hBox = (node.boxHeight || 36) * badgeScale;
            const xBox = node.x - wBox / 2;
            const yBox = node.y - hBox / 2;
            const rCorner = hBox / 2; // 端が完全に丸いピル（カプセル）型

            // ドロップシャドウ
            ctx.save();
            ctx.shadowColor = isHover ? 'rgba(37, 99, 235, 0.45)' : 'rgba(15, 23, 42, 0.16)';
            ctx.shadowBlur = isHover ? 12 : (isExport ? 8 : 5);
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = isHover ? 3 : (isExport ? 3 : 2);

            // ピル型塗りつぶし
            ctx.beginPath();
            if (ctx.roundRect) {
                ctx.roundRect(xBox, yBox, wBox, hBox, rCorner);
            } else {
                ctx.rect(xBox, yBox, wBox, hBox);
            }
            ctx.fillStyle = isHover ? '#1D4ED8' : node.color;
            ctx.fill();
            ctx.restore();

            // 枠線（白い太フチでノードを際立たせる）
            ctx.beginPath();
            if (ctx.roundRect) {
                ctx.roundRect(xBox, yBox, wBox, hBox, rCorner);
            } else {
                ctx.rect(xBox, yBox, wBox, hBox);
            }
            ctx.strokeStyle = isHover ? '#FFFFFF' : (node.strokeColor || '#FFFFFF');
            ctx.lineWidth = isHover ? 2.8 : (isExport ? 3.0 : 2.0);
            ctx.stroke();

            // テキストラベル「👥 {label} ({count})」の見切れ防止スケーリング
            const fullText = `👥 ${node.label} (${node.docCount})`;
            let fSize = isExport ? 20 : 12;
            ctx.font = `bold ${fSize}px sans-serif`;
            const maxTextW = wBox - (isExport ? 28 : 22);
            const minFSize = isExport ? 14.0 : 9.0;
            while (ctx.measureText(fullText).width > maxTextW && fSize > minFSize) {
                fSize -= 0.5;
                ctx.font = `bold ${fSize}px sans-serif`;
            }

            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#FFFFFF';
            ctx.fillText(fullText, node.x, node.y);
        });

        // 3. 単語ノード（第3層: 円・リング本体）
        this.nodes.filter(n => !n.isAttrNode).forEach(node => {
            const isConnectedToHover = !isExport && this.hoverNode &&
                (this.hoverNode.id === node.id || this.edges.some(e =>
                    (e.source.id === this.hoverNode.id && e.target.id === node.id) ||
                    (e.target.id === this.hoverNode.id && e.source.id === node.id)
                ));

            const nodeRadius = isExport ? (node.radius * 1.3) : node.radius;

            // 円本体
            ctx.beginPath();
            ctx.arc(node.x, node.y, nodeRadius, 0, Math.PI * 2);
            ctx.fillStyle = isConnectedToHover ? '#2563EB' : node.color;
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = isExport ? 3.5 : 2.5;
            ctx.stroke();

            // 共通語（複数属性に接続）の場合はアクセント外周リング
            if (node.isShared) {
                ctx.beginPath();
                ctx.arc(node.x, node.y, nodeRadius + (isExport ? 5.0 : 3.8), 0, Math.PI * 2);
                ctx.strokeStyle = isConnectedToHover ? '#1D4ED8' : '#F59E0B'; // ゴールドリング
                ctx.lineWidth = isExport ? 3.2 : 2.2;
                ctx.stroke();
            }
        });

        // 4. 単語ノード（第4層: 最前面テキストラベル）
        // 最前面レイヤーに描画することで、属性ノードやエッジによる文字の欠け・隠れを完全防止
        this.nodes.filter(n => !n.isAttrNode).forEach(node => {
            const isConnectedToHover = !isExport && this.hoverNode &&
                (this.hoverNode.id === node.id || this.edges.some(e =>
                    (e.source.id === this.hoverNode.id && e.target.id === node.id) ||
                    (e.target.id === this.hoverNode.id && e.source.id === node.id)
                ));

            // エクスポート（印刷・レポート）時は縮小表示でもクッキリ読めるよう文字サイズを大幅拡大
            const fSize = isExport ? (node.isShared ? 25 : 22) : (node.isShared ? 14 : 12.5);
            ctx.font = `bold ${fSize}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';

            const nodeRadius = isExport ? (node.radius * 1.3) : node.radius;
            const textY = node.y + nodeRadius + (isExport ? 7 : 5);
            ctx.save();
            ctx.lineJoin = 'round';
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.96)';
            ctx.lineWidth = isExport ? 7.5 : 5.0;
            ctx.strokeText(node.label, node.x, textY);
            ctx.fillStyle = node.isShared ? '#312E81' : (isConnectedToHover ? '#1D4ED8' : '#0F172A');
            ctx.fillText(node.label, node.x, textY);
            ctx.restore();
        });

        ctx.restore();

        // 5. ホバー時の詳細ツールチップ（画面固定スケールで描画）
        if (!isExport && this.hoverNode) {
            const hn = this.hoverNode;
            let tipText = '';
            if (hn.isAttrNode) {
                tipText = `【属性】${hn.label}: 関連意見 ${hn.docCount}件 (クリックで意見概要を表示)`;
            } else if (hn.isShared) {
                if (this.attrMetric === 'distinct') {
                    tipText = `【共通特徴語】${hn.label} (${hn.connectedCats.join('・')}で共通して突出)`;
                } else {
                    tipText = `【共通高頻度語】${hn.label} (${hn.connectedCats.join('・')}で共通言及)`;
                }
            } else {
                const cat = (hn.connectedCats && hn.connectedCats[0]) || '';
                if (this.attrMetric === 'distinct' && hn.scoreInfo) {
                    const zStr = (hn.scoreInfo.zScore !== undefined) ? ` (特異度 Z:+${Math.max(0, hn.scoreInfo.zScore).toFixed(1)})` : '';
                    tipText = `【${cat} 特有語】${hn.label}${zStr}: 該当${hn.scoreInfo.count || hn.count}件 / 全体${hn.scoreInfo.totalCount || hn.count}件`;
                } else {
                    const cntStr = hn.count ? ` (${hn.count}件)` : '';
                    tipText = `【${cat} 高頻度語】${hn.label}${cntStr}`;
                }
            }

            ctx.font = 'bold 12px sans-serif';
            const metrics = ctx.measureText(tipText);
            const tipW = metrics.width + 20;
            const tipH = 26;
            const screenX = hn.x * scale + panX;
            const screenY = hn.y * scale + panY;
            const halfBoxH = (hn.boxHeight || 28) * scale / 2;
            const tipR = (hn.radius || 12) * scale;
            const tipOffset = hn.isAttrNode ? (halfBoxH + 26) : (tipR + 26);
            const tipX = Math.max(10, Math.min(w - tipW - 10, screenX - tipW / 2));
            const tipY = Math.max(10, screenY - tipOffset);

            ctx.save();
            ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1;
            ctx.beginPath();
            if (ctx.roundRect) {
                ctx.roundRect(tipX, tipY, tipW, tipH, 5);
            } else {
                ctx.rect(tipX, tipY, tipW, tipH);
            }
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(tipText, tipX + tipW / 2, tipY + tipH / 2);
            ctx.restore();
        }

        // 6. 属性ネットワーク用ヘッダー・凡例・ガイドの描画（画面固定座標）
        this.drawAttrLegend(ctx, w, h, isExport);
    },

    /**
     * 属性ネットワーク用の凡例・ガイド描画
     * 超スリムな横長ヘッダー形式に統合し、ノードへの被りを完全に防止
     */
    drawAttrLegend(ctx, w, h, isExport = false) {
        ctx.save();

        const padX = isExport ? 16 : 12;
        const padY = isExport ? 8 : 6;
        const barH = isExport ? 30 : 22;

        // (1) 左上タイトルバッジ（横長スリムインライン表示）
        ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
        ctx.strokeStyle = '#CBD5E1';
        ctx.lineWidth = isExport ? 1.5 : 1;

        const kwPart = this.targetKeyword ? ` [対象: 🎯${this.targetKeyword}]` : '';
        const metricBadge = this.attrMetric === 'distinct' ? '🎯 特徴度重視' : '📊 頻度重視';
        const titleText = `👥 属性別 結びつき (${this.attrColName || '属性'})${kwPart}  |  ${metricBadge}`;

        ctx.font = isExport ? 'bold 14px sans-serif' : 'bold 10.5px sans-serif';
        const textW = ctx.measureText(titleText).width;
        const maxTitleW = w * 0.64;
        const badgeW = Math.min(maxTitleW, textW + (isExport ? 22 : 16));

        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(padX, padY, badgeW, barH, isExport ? 6 : 4);
        } else {
            ctx.rect(padX, padY, badgeW, barH);
        }
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#1E293B';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.save();
        ctx.beginPath();
        ctx.rect(padX + 2, padY, badgeW - 4, barH);
        ctx.clip();
        ctx.fillText(titleText, padX + (isExport ? 10 : 8), padY + barH / 2);
        ctx.restore();

        // (2) 右上凡例（超コンパクト・1行インライン凡例）
        ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
        ctx.strokeStyle = '#CBD5E1';
        ctx.lineWidth = isExport ? 1.5 : 1;
        const legW = isExport ? 290 : 200;
        const legX = w - legW - padX;

        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(legX, padY, legW, barH, isExport ? 6 : 4);
        } else {
            ctx.rect(legX, padY, legW, barH);
        }
        ctx.fill();
        ctx.stroke();

        const midY = padY + barH / 2;

        // 凡例アイコン1: 属性ノード（ピル）
        ctx.fillStyle = '#2563EB';
        const icon1W = isExport ? 18 : 13;
        const icon1H = isExport ? 12 : 9;
        if (ctx.roundRect) {
            ctx.beginPath();
            ctx.roundRect(legX + (isExport ? 10 : 7), midY - icon1H / 2, icon1W, icon1H, 3);
            ctx.fill();
        } else {
            ctx.fillRect(legX + (isExport ? 10 : 7), midY - icon1H / 2, icon1W, icon1H);
        }
        ctx.fillStyle = '#334155';
        ctx.font = isExport ? 'bold 13px sans-serif' : 'bold 9.5px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('属性グループ', legX + (isExport ? 32 : 23), midY);

        // 凡例アイコン2: 共通語（ゴールド二重丸）
        const icon2X = legX + (isExport ? 152 : 108);
        const icon2Y = midY;
        ctx.beginPath();
        ctx.arc(icon2X, icon2Y, isExport ? 6 : 4.5, 0, Math.PI * 2);
        ctx.fillStyle = '#4F46E5';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(icon2X, icon2Y, isExport ? 8.5 : 6.5, 0, Math.PI * 2);
        ctx.strokeStyle = '#F59E0B';
        ctx.lineWidth = isExport ? 1.8 : 1.2;
        ctx.stroke();
        ctx.fillStyle = '#334155';
        const sharedLabel = this.attrMetric === 'distinct' ? '共通特徴語' : '共通語';
        ctx.fillText(sharedLabel, icon2X + (isExport ? 14 : 10), midY);

        ctx.restore();
    },

    /**
     * 資料向け高解像度・オートフィット（最大化＆中央配置）キャンバスを取得
     * PowerPoint/Wordでの利用を想定した4:3比率 (1200x900)
     * @param {number} [targetW=1200]
     * @param {number} [targetH=900]
     * @returns {HTMLCanvasElement|null}
     */
    getExportCanvas(targetW = 1200, targetH = 900) {
        if (!this.nodes || this.nodes.length === 0) return null;

        // ノード群のバウンディングボックスを計算（ラベル・半径込み）
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        this.nodes.forEach(n => {
            let padLeft = 0, padRight = 0, padTop = 0, padBottom = 0;
            if (n.isAttrNode) {
                // 属性バッジ（エクスポート時は 1.45 倍スケールで中央配置）
                const halfW = ((n.boxWidth || 100) * 1.45) / 2;
                const halfH = ((n.boxHeight || 36) * 1.45) / 2;
                padLeft = padRight = halfW + 8;
                padTop = padBottom = halfH + 8;
            } else {
                // 単語ノード（円＋下部テキスト）
                const r = (n.radius || 14) * 1.3;
                const textHalfW = Math.max(16, ((n.label || n.id || '').length * 13) / 2 + 4);
                padLeft = padRight = Math.max(r, textHalfW);
                padTop = r + 4;
                padBottom = r + 24; // テキストラベルはノード円の下側に配置される
            }

            if (n.x - padLeft < minX) minX = n.x - padLeft;
            if (n.x + padRight > maxX) maxX = n.x + padRight;
            if (n.y - padTop < minY) minY = n.y - padTop;
            if (n.y + padBottom > maxY) maxY = n.y + padBottom;
        });

        const bboxW = Math.max(100, maxX - minX);
        const bboxH = Math.max(100, maxY - minY);

        // 周囲マージン
        // 上部: タイトルバッジ（上端8px〜高さ26/30px）と絶対に干渉しない安全領域（単語共起:38px / 属性:44px）
        // 左右・下部: 限界まで余白をスリム化（左右16px、下部14px）し、グラフ描画エリアをキャンバスの94%以上に最大化フィット
        const isAttr = this.networkMode === 'attr';
        const marginX = 16;
        const marginTop = isAttr ? 44 : 38;
        const marginBottom = 14;

        const availW = targetW - marginX * 2;
        const availH = targetH - (marginTop + marginBottom);

        // 利用可能領域に対して最大限大きくフィットさせる倍率
        const autoScale = Math.min(availW / bboxW, availH / bboxH);

        // バウンディングボックスの中心を、利用可能領域の中心に合わせる
        const bboxCenterX = (minX + maxX) / 2;
        const bboxCenterY = (minY + maxY) / 2;

        const targetCenterX = targetW / 2;
        const targetCenterY = marginTop + availH / 2;

        const autoPanX = targetCenterX - bboxCenterX * autoScale;
        const autoPanY = targetCenterY - bboxCenterY * autoScale;

        // オフスクリーンキャンバスに白背景で描画
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = targetW;
        exportCanvas.height = targetH;
        const ctx = exportCanvas.getContext('2d');

        this.renderToContext(ctx, targetW, targetH, autoScale, autoPanX, autoPanY, true);
        return exportCanvas;
    },

    /**
     * 指定された単語選出基準（distinct: 特徴度重視 / freq: 頻度重視）で属性ネットワークを一時レンダリングして画像キャンバスを取得
     * 現在の表示状態を壊さずに安全に復元する
     * @param {'distinct'|'freq'} metric
     * @param {Array<object>} matchedDocs
     * @param {string} attrCol
     * @param {Array<object>} targetRows
     * @param {string} targetKeyword
     * @param {object} [options={}]
     * @param {number} [targetW=1200]
     * @param {number} [targetH=900]
     * @returns {HTMLCanvasElement|null}
     */
    getExportCanvasForAttrMetric(metric, matchedDocs, attrCol, targetRows, targetKeyword, options = {}, targetW = 1200, targetH = 900) {
        if (!attrCol || !matchedDocs || matchedDocs.length === 0) return null;

        const prevMode = this.networkMode;
        const prevMetric = this.attrMetric;
        const prevNodes = this.nodes;
        const prevEdges = this.edges;
        const prevScale = this.scale;
        const prevPanX = this.panX;
        const prevPanY = this.panY;
        const prevTargetKw = this.targetKeyword;
        const prevResolved = this.resolvedTargetWord;
        const prevColName = this.attrColName;

        try {
            this.renderAttrNetwork(matchedDocs, attrCol, targetRows, targetKeyword, {
                ...options,
                isExport: true,
                wordsPerAttr: options.wordsPerAttr || 4, // レポート専用スリム化
                attrMetric: metric
            });
            return this.getExportCanvas(targetW, targetH);
        } finally {
            this.networkMode = prevMode;
            this.attrMetric = prevMetric;
            this.nodes = prevNodes;
            this.edges = prevEdges;
            this.scale = prevScale;
            this.panX = prevPanX;
            this.panY = prevPanY;
            this.targetKeyword = prevTargetKw;
            this.resolvedTargetWord = prevResolved;
            this.attrColName = prevColName;
            if (this.ctx && this.canvas) this.renderFrame();
        }
    },

    /**
     * 単語共起ネットワーク（全体の話題構造）を一時レンダリングして画像キャンバスを取得
     * 現在の表示状態を壊さずに安全に復元する
     */
    getExportCanvasForWordNetwork(wordList, coocCounts, targetKeyword, activeRelatedWords, options = {}, targetW = 1200, targetH = 900) {
        if (!wordList || wordList.length === 0) return null;

        const prevMode = this.networkMode;
        const prevMetric = this.attrMetric;
        const prevNodes = this.nodes;
        const prevEdges = this.edges;
        const prevScale = this.scale;
        const prevPanX = this.panX;
        const prevPanY = this.panY;
        const prevTargetKw = this.targetKeyword;
        const prevResolved = this.resolvedTargetWord;

        try {
            this.render(wordList, coocCounts, targetKeyword, activeRelatedWords, {
                ...options,
                isExport: true
            });
            return this.getExportCanvas(targetW, targetH);
        } finally {
            this.networkMode = prevMode;
            this.attrMetric = prevMetric;
            this.nodes = prevNodes;
            this.edges = prevEdges;
            this.scale = prevScale;
            this.panX = prevPanX;
            this.panY = prevPanY;
            this.targetKeyword = prevTargetKw;
            this.resolvedTargetWord = prevResolved;
            if (this.ctx && this.canvas) this.renderFrame();
        }
    },

    /**
     * 凡例（Legend）の描画
     * 図との重なりを防止するため、内容を最小限に凝縮し、
     * 最もノードと干渉しにくい左下隅にスリムなインラインバッジバーとして配置
     */
    drawLegend(ctx, w, h, isExport = false) {
        ctx.save();

        // (1) 左上タイトルバッジ（超スリム・コンパクト化でノードへの被りを完全に防止）
        if (this.targetKeyword) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
            ctx.strokeStyle = '#CBD5E1';
            ctx.lineWidth = isExport ? 1.5 : 1;
            const kwLabel = `🌐 単語共起ネットワーク [対象: 🎯${this.targetKeyword}]`;
            ctx.font = isExport ? 'bold 15px sans-serif' : 'bold 11px sans-serif';
            const textMetrics = ctx.measureText(kwLabel);
            const badgeW = Math.min(w * 0.65, textMetrics.width + (isExport ? 22 : 16));
            const badgeH = isExport ? 26 : 20;
            const badgeX = isExport ? 16 : 12;
            const badgeY = isExport ? 8 : 6;

            ctx.beginPath();
            if (ctx.roundRect) {
                ctx.roundRect(badgeX, badgeY, badgeW, badgeH, isExport ? 6 : 4);
            } else {
                ctx.rect(badgeX, badgeY, badgeW, badgeH);
            }
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#1E293B';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            // 文字がバッジからはみ出さないようクリップ
            ctx.save();
            ctx.beginPath();
            ctx.rect(badgeX + 2, badgeY, badgeW - 4, badgeH);
            ctx.clip();
            ctx.fillText(kwLabel, badgeX + (isExport ? 10 : 8), badgeY + badgeH / 2);
            ctx.restore();
        }

        ctx.font = isExport ? 'bold 15px sans-serif' : '10.5px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        const palette = [
            '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#3b82f6', '#f97316', '#14b8a6', '#64748b'
        ];

        // 最小限の凡例アイテムを構成
        const items = [];
        items.push({ type: 'target', label: '中心語', color: '#e11d48' });
        items.push({ type: 'related', label: '関連語', color: '#0284c7' });

        if (this.colorMode === 'role') {
            items.push({ type: 'dot', label: '共起語', color: '#10b981' });
        } else {
            const themes = this.communityThemes || [];
            if (themes.length > 0) {
                themes.forEach((th, idx) => {
                    const shortLabel = (th.label || '').split('・')[0] || `G${idx + 1}`;
                    items.push({
                        type: 'dot',
                        label: shortLabel,
                        color: palette[idx % palette.length]
                    });
                });
            } else {
                items.push({ type: 'multi-dots', label: '話題グループ', colors: ['#10b981', '#f59e0b', '#8b5cf6'] });
            }
        }

        // 線種の凡例（直接共起 vs 関連語同士の共起）
        items.push({ type: 'edge-direct', label: '直接共起', color: '#2563eb' });
        items.push({ type: 'edge-sub', label: '関連語間', color: '#94a3b8' });

        // 横幅の自動計算
        let totalContentW = 0;
        const itemWidths = items.map(item => {
            let itemW = 0;
            const iconW = isExport ? 20 : 14;
            if (item.type === 'target' || item.type === 'related') itemW = iconW + ctx.measureText(item.label).width;
            else if (item.type === 'multi-dots') itemW = (isExport ? 36 : 26) + ctx.measureText(item.label).width;
            else if (item.type === 'edge-direct' || item.type === 'edge-sub') itemW = (isExport ? 30 : 22) + ctx.measureText(item.label).width;
            else itemW = (isExport ? 18 : 13) + ctx.measureText(item.label).width;
            totalContentW += itemW + (isExport ? 14 : 10);
            return itemW;
        });

        const boxPadX = isExport ? 16 : 10;
        const boxH = isExport ? 40 : 26;
        const boxW = Math.min(w - 28, totalContentW + boxPadX * 2 - 2);

        // 左下隅に配置（ネットワーク図の中心から離れ、最も重なりにくいエリア）
        const x = 14;
        const y = h - boxH - 12;

        // 背景プレート（半透明白＋淡いボーダー）
        ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
        ctx.strokeStyle = 'rgba(203, 213, 225, 0.95)';
        ctx.lineWidth = isExport ? 1.5 : 1;
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(x, y, boxW, boxH, isExport ? 8 : 6) : ctx.rect(x, y, boxW, boxH);
        ctx.fill();
        ctx.stroke();

        // アイテムの描画
        let curX = x + boxPadX;
        const midY = y + boxH / 2;

        items.forEach((item, idx) => {
            const rad = isExport ? 6.5 : 4.5;
            if (item.type === 'target') {
                ctx.beginPath();
                ctx.arc(curX + rad, midY, rad, 0, Math.PI * 2);
                ctx.fillStyle = item.color;
                ctx.fill();
                ctx.beginPath();
                ctx.arc(curX + rad, midY, rad + (isExport ? 2.5 : 2.0), 0, Math.PI * 2);
                ctx.strokeStyle = '#f43f5e';
                ctx.lineWidth = isExport ? 1.6 : 1.2;
                ctx.stroke();

                ctx.fillStyle = '#334155';
                ctx.fillText(item.label, curX + rad * 2 + (isExport ? 8 : 5), midY);
            } else if (item.type === 'related') {
                ctx.beginPath();
                ctx.arc(curX + rad, midY, rad - 0.5, 0, Math.PI * 2);
                ctx.fillStyle = '#64748b';
                ctx.fill();
                ctx.beginPath();
                ctx.arc(curX + rad, midY, rad + (isExport ? 2.0 : 1.8), 0, Math.PI * 2);
                ctx.strokeStyle = '#0284c7';
                ctx.lineWidth = isExport ? 1.8 : 1.4;
                ctx.stroke();

                ctx.fillStyle = '#334155';
                ctx.fillText(item.label, curX + rad * 2 + (isExport ? 8 : 5), midY);
            } else if (item.type === 'multi-dots') {
                item.colors.forEach((c, cIdx) => {
                    ctx.beginPath();
                    ctx.arc(curX + 4 + cIdx * 6, midY, 2.5, 0, Math.PI * 2);
                    ctx.fillStyle = c;
                    ctx.fill();
                });
                ctx.fillStyle = '#334155';
                ctx.fillText(item.label, curX + 24, midY);
            } else if (item.type === 'edge-direct') {
                ctx.save();
                ctx.strokeStyle = item.color;
                ctx.lineWidth = 2.4;
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.moveTo(curX + 2, midY);
                ctx.lineTo(curX + 16, midY);
                ctx.stroke();
                ctx.restore();

                ctx.fillStyle = '#334155';
                ctx.fillText(item.label, curX + 20, midY);
            } else if (item.type === 'edge-sub') {
                ctx.save();
                ctx.strokeStyle = item.color;
                ctx.lineWidth = 1.4;
                ctx.setLineDash([3, 2]);
                ctx.beginPath();
                ctx.moveTo(curX + 2, midY);
                ctx.lineTo(curX + 16, midY);
                ctx.stroke();
                ctx.restore();

                ctx.fillStyle = '#64748b';
                ctx.fillText(item.label, curX + 20, midY);
            } else {
                ctx.beginPath();
                ctx.arc(curX + 4, midY, 4, 0, Math.PI * 2);
                ctx.fillStyle = item.color;
                ctx.fill();

                ctx.fillStyle = '#334155';
                ctx.fillText(item.label, curX + 12, midY);
            }

            curX += itemWidths[idx] + 10;
        });

        ctx.restore();
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = NetworkVisualizer;
}
