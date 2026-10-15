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
        const height = this.canvas ? this.canvas.height : 520;
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

        const parentW = this.canvas.parentElement ? this.canvas.parentElement.clientWidth : 0;
        const parentH = this.canvas.parentElement ? this.canvas.parentElement.clientHeight : 0;
        const width = Math.min(1600, parentW > 50 ? parentW : 960);
        const height = Math.min(1000, parentH > 50 ? parentH : 520);
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

        // 2. コミュニティ検出 (Label Propagation)
        this.detectCommunities();

        // 3. 物理シミュレーションの実行（高速に初期収束させる）
        this.simulateLayout(160);

        // 4. 初回描画
        this.renderFrame();
    },

    detectCommunities() {
        for (let iter = 0; iter < 10; iter++) {
            this.nodes.forEach(node => {
                const neighborLabels = {};
                this.edges.forEach(edge => {
                    if (edge.source.id === node.id) {
                        neighborLabels[edge.target.community] = (neighborLabels[edge.target.community] || 0) + edge.weight;
                    } else if (edge.target.id === node.id) {
                        neighborLabels[edge.source.community] = (neighborLabels[edge.source.community] || 0) + edge.weight;
                    }
                });
                let maxLabel = node.community;
                let maxWeight = 0;
                Object.entries(neighborLabels).forEach(([lbl, wt]) => {
                    if (wt > maxWeight) {
                        maxWeight = wt;
                        maxLabel = lbl;
                    }
                });
                node.community = maxLabel;
            });
        }

        const counts = {};
        this.nodes.forEach(n => { counts[n.community] = (counts[n.community] || 0) + 1; });
        const sorted = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
        this.nodes.forEach(n => {
            const idx = sorted.indexOf(n.community);
            n.communityIndex = idx >= 0 ? idx : 0;
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
        this.edges.forEach(e => {
            const isConnectedToHover = !isExport && this.hoverNode && (e.source.id === this.hoverNode.id || e.target.id === this.hoverNode.id);
            const alpha = (!isExport && this.hoverNode)
                ? (isConnectedToHover ? 0.9 : 0.08)
                : 0.25 + (e.weight / maxWeight) * 0.45;

            const lineWidth = (!isExport && this.hoverNode && isConnectedToHover)
                ? Math.min(4.5, 1.5 + (e.weight / maxWeight) * 3.5)
                : Math.min(3, 0.8 + (e.weight / maxWeight) * 2.2);

            ctx.strokeStyle = (!isExport && isConnectedToHover) ? '#2563eb' : `rgba(148, 163, 184, ${alpha})`;
            ctx.lineWidth = lineWidth;
            ctx.beginPath();
            ctx.moveTo(e.source.x, e.source.y);
            ctx.lineTo(e.target.x, e.target.y);
            ctx.stroke();
        });

        // 2. ノード描画
        // 話題グループ（コミュニティ）向けの多彩で見分けやすい配色パレット
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
                    fillColor = palette[node.communityIndex % palette.length];
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

        // 凡例領域（右上）および周囲マージン
        const marginX = 50;
        const marginTop = 90; // 凡例用
        const marginBottom = 50;

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

    drawLegend(ctx, w, h) {
        // 右上に簡潔な凡例を表示
        const pad = 12;
        const boxW = 190;
        const boxH = 75;
        const x = w - boxW - pad;
        const y = pad;

        ctx.save();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(x, y, boxW, boxH, 6) : ctx.rect(x, y, boxW, boxH);
        ctx.fill();
        ctx.stroke();

        ctx.font = '11px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        if (this.colorMode === 'role') {
            // 役割別モードの凡例
            // 1. ターゲットキーワード
            ctx.beginPath();
            ctx.arc(x + 16, y + 16, 6, 0, Math.PI * 2);
            ctx.fillStyle = '#e11d48';
            ctx.fill();
            ctx.fillStyle = '#334155';
            ctx.fillText('指定キーワード (注目中心)', x + 28, y + 16);

            // 2. 関連語
            ctx.beginPath();
            ctx.arc(x + 16, y + 36, 5, 0, Math.PI * 2);
            ctx.fillStyle = '#0284c7';
            ctx.fill();
            ctx.fillStyle = '#334155';
            ctx.fillText('関連語 (共起・文脈近傍)', x + 28, y + 36);

            // 3. その他共起語
            ctx.beginPath();
            ctx.arc(x + 16, y + 56, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#10b981';
            ctx.fill();
            ctx.fillStyle = '#334155';
            ctx.fillText('その他の共起単語', x + 28, y + 56);
        } else {
            // 話題グループ（コミュニティ）別モードの凡例
            // 1. ターゲットキーワード
            ctx.beginPath();
            ctx.arc(x + 16, y + 16, 6, 0, Math.PI * 2);
            ctx.fillStyle = '#e11d48';
            ctx.fill();
            ctx.beginPath();
            ctx.arc(x + 16, y + 16, 8, 0, Math.PI * 2);
            ctx.strokeStyle = '#f43f5e';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.fillStyle = '#334155';
            ctx.fillText('指定キーワード (中心語)', x + 28, y + 16);

            // 2. 関連語マーク（アクセントリング）
            ctx.beginPath();
            ctx.arc(x + 16, y + 36, 5, 0, Math.PI * 2);
            ctx.fillStyle = '#64748b';
            ctx.fill();
            ctx.beginPath();
            ctx.arc(x + 16, y + 36, 7.5, 0, Math.PI * 2);
            ctx.strokeStyle = '#0284c7';
            ctx.lineWidth = 1.8;
            ctx.stroke();
            ctx.fillStyle = '#334155';
            ctx.fillText('関連語 (選択中・外枠青)', x + 28, y + 36);

            // 3. 話題グループ色分けサンプル
            const dotX = x + 12;
            const colors = ['#10b981', '#f59e0b', '#8b5cf6', '#06b6d4'];
            colors.forEach((c, idx) => {
                ctx.beginPath();
                ctx.arc(dotX + idx * 7, y + 56, 3, 0, Math.PI * 2);
                ctx.fillStyle = c;
                ctx.fill();
            });
            ctx.fillStyle = '#334155';
            ctx.fillText('色: 話題グループ(クラスター)', x + 44, y + 56);
        }

        ctx.restore();
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = NetworkVisualizer;
}
