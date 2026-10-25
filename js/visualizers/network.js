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
            if (hit && typeof this.onWordClick === 'function') {
                this.onWordClick(hit.id);
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
        this.scale = this.spacingMode === 'widest' ? 0.75 : (this.spacingMode === 'wide' ? 0.85 : 0.95);
        this.panX = (width * (1 - this.scale)) / 2;
        this.panY = (height * (1 - this.scale)) / 2;
        this.renderFrame();
    },

    findNodeAt(x, y) {
        for (let i = this.nodes.length - 1; i >= 0; i--) {
            const n = this.nodes[i];
            const dx = n.x - x;
            const dy = n.y - y;
            if (dx * dx + dy * dy <= (n.radius + 4) * (n.radius + 4)) {
                return n;
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
        const tLower = (this.targetKeyword || '').toLowerCase();
        const rLower = (this.resolvedTargetWord || '').toLowerCase();
        if (idLower === tLower || idLower === rLower) return true;
        if (tLower && (idLower.includes(tLower) || tLower.includes(idLower))) return true;
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

        this.targetKeyword = targetKeyword;
        this.resolvedTargetWord = options.resolvedTargetWord || targetKeyword;
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
        this.panY = (height * (1 - this.scale)) / 2;

        const maxWords = options.maxWords || 40;
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

        // ターゲットキーワードおよび解決された代表複合語は必ずノードに含める
        let targetAdded = false;
        if (wordSet.has(this.resolvedTargetWord)) {
            connectedNodes.add(this.resolvedTargetWord);
            targetAdded = true;
        }
        if (wordSet.has(this.targetKeyword)) {
            connectedNodes.add(this.targetKeyword);
            targetAdded = true;
        }
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

        // 間隔設定に基づく物理定数
        const spacingParams = {
            normal: { baseLen: 120, kRepel: 8000, minPadding: 35, gravity: 0.005 },
            wide:   { baseLen: 175, kRepel: 16000, minPadding: 50, gravity: 0.003 },
            widest: { baseLen: 240, kRepel: 26000, minPadding: 70, gravity: 0.002 }
        };
        const p = spacingParams[this.spacingMode] || spacingParams.wide;

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
            const springK = 0.035;
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
                // ターゲットノード（中東情勢など中心語）を中心へ強固に引き寄せて中心に安定化
                const g = n.isTarget ? p.gravity * 4.0 : p.gravity;
                n.vx += (centerX - n.x) * g;
                n.vy += (centerY - n.y) * g;

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

            // テキストラベル（大きく読みやすいフォント設定）
            const fontSizes = {
                normal: { target: 15, related: 13, other: 12 },
                large:   { target: 17, related: 15, other: 14 },
                xlarge:  { target: 20, related: 18, other: 16 }
            };
            const fCfg = fontSizes[this.fontSize] || fontSizes.large;
            const fSize = isTarget ? fCfg.target : (isRelated ? fCfg.related : fCfg.other);

            ctx.font = `bold ${fSize}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';

            const textY = node.y + node.radius + 4;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = Math.max(4, Math.round(fSize * 0.32));
            ctx.strokeText(node.id, node.x, textY);
            ctx.fillStyle = isTarget ? '#9f1239' : (isRelated ? '#0369a1' : '#1e293b');
            ctx.fillText(node.id, node.x, textY);
        });

        // 3. ホバーノードの詳細ツールチップ
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
            const tipX = hn.x - tipW / 2;
            const tipY = hn.y - hn.radius - 32;

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
            ctx.fillText(tipText, hn.x, tipY + tipH / 2);
            ctx.restore();
        }

        ctx.restore();
        this.drawLegend(ctx, w, h);
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
            const padX = n.radius + Math.max(24, (n.id || '').length * 8.5);
            const padY = n.radius + 28;
            if (n.x - padX < minX) minX = n.x - padX;
            if (n.x + padX > maxX) maxX = n.x + padX;
            if (n.y - padY < minY) minY = n.y - padY;
            if (n.y + padY > maxY) maxY = n.y + padY;
        });

        const bboxW = Math.max(100, maxX - minX);
        const bboxH = Math.max(100, maxY - minY);

        // 周囲マージン（凡例が下部スリムバーのため上下均等に美しくフィット）
        const marginX = 50;
        const marginTop = 50;
        const marginBottom = 55;

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
     * 凡例（Legend）の描画
     * 図との重なりを防止するため、内容を最小限に凝縮し、
     * 最もノードと干渉しにくい左下隅にスリムなインラインバッジバーとして配置
     */
    drawLegend(ctx, w, h) {
        ctx.save();
        ctx.font = '10.5px sans-serif';
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
            if (item.type === 'target') itemW = 14 + ctx.measureText(item.label).width;
            else if (item.type === 'related') itemW = 14 + ctx.measureText(item.label).width;
            else if (item.type === 'multi-dots') itemW = 26 + ctx.measureText(item.label).width;
            else if (item.type === 'edge-direct' || item.type === 'edge-sub') itemW = 22 + ctx.measureText(item.label).width;
            else itemW = 13 + ctx.measureText(item.label).width;
            totalContentW += itemW + 10;
            return itemW;
        });

        const boxPadX = 10;
        const boxH = 26;
        const boxW = Math.min(w - 28, totalContentW + boxPadX * 2 - 2);

        // 左下隅に配置（ネットワーク図の中心から離れ、最も重なりにくいエリア）
        const x = 14;
        const y = h - boxH - 12;

        // 背景プレート（半透明白＋淡いボーダー）
        ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
        ctx.strokeStyle = 'rgba(203, 213, 225, 0.85)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(x, y, boxW, boxH, 6) : ctx.rect(x, y, boxW, boxH);
        ctx.fill();
        ctx.stroke();

        // アイテムの描画
        let curX = x + boxPadX;
        const midY = y + boxH / 2;

        items.forEach((item, idx) => {
            if (item.type === 'target') {
                ctx.beginPath();
                ctx.arc(curX + 5, midY, 4.5, 0, Math.PI * 2);
                ctx.fillStyle = item.color;
                ctx.fill();
                ctx.beginPath();
                ctx.arc(curX + 5, midY, 6.5, 0, Math.PI * 2);
                ctx.strokeStyle = '#f43f5e';
                ctx.lineWidth = 1.2;
                ctx.stroke();

                ctx.fillStyle = '#334155';
                ctx.fillText(item.label, curX + 14, midY);
            } else if (item.type === 'related') {
                ctx.beginPath();
                ctx.arc(curX + 5, midY, 4, 0, Math.PI * 2);
                ctx.fillStyle = '#64748b';
                ctx.fill();
                ctx.beginPath();
                ctx.arc(curX + 5, midY, 5.8, 0, Math.PI * 2);
                ctx.strokeStyle = '#0284c7';
                ctx.lineWidth = 1.4;
                ctx.stroke();

                ctx.fillStyle = '#334155';
                ctx.fillText(item.label, curX + 14, midY);
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
