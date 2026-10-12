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
            e.preventDefault();
            const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
            const newScale = Math.max(0.4, Math.min(3.0, this.scale * zoomFactor));

            const rect = c.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            this.panX = mouseX - (mouseX - this.panX) * (newScale / this.scale);
            this.panY = mouseY - (mouseY - this.panY) * (newScale / this.scale);
            this.scale = newScale;
            this.renderFrame();
        }, { passive: false });
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
     */
    render(wordList, coocCounts, targetKeyword, activeRelatedWords, options = {}) {
        if (!this.canvas) return;
        if (this.animId) cancelAnimationFrame(this.animId);

        this.targetKeyword = targetKeyword;
        this.activeRelatedWords = activeRelatedWords || [];
        this.onWordClick = options.onWordClick;
        this.spacingMode = options.spacingMode || 'wide'; // 'normal' | 'wide' | 'widest'

        const parentW = this.canvas.parentElement ? this.canvas.parentElement.clientWidth : 0;
        const width = parentW > 50 ? parentW : (this.canvas.clientWidth > 50 ? this.canvas.clientWidth : 800);
        const height = 520;
        this.canvas.width = width;
        this.canvas.height = height;

        // 初期スケール（ノードが広がるため、ゆったり全体が見える倍率に調整）
        this.scale = this.spacingMode === 'widest' ? 0.75 : (this.spacingMode === 'wide' ? 0.85 : 0.95);
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

        // ターゲットキーワードは必ずノードに含める
        if (wordSet.has(targetKeyword)) connectedNodes.add(targetKeyword);
        // 上位関連語も優先
        for (const rw of this.activeRelatedWords) {
            if (wordSet.has(rw)) connectedNodes.add(rw);
        }

        // ノードリスト生成
        const countsMap = {};
        topWords.forEach(w => { countsMap[w.text] = w.count; });

        const maxCount = Math.max(...Array.from(connectedNodes).map(id => countsMap[id] || 1), 1);
        const minCount = Math.min(...Array.from(connectedNodes).map(id => countsMap[id] || 1), 1);

        this.nodes = Array.from(connectedNodes).map(id => {
            const cnt = countsMap[id] || 1;
            const rScale = maxCount > minCount ? (cnt - minCount) / (maxCount - minCount) : 0.5;
            const radius = 9 + rScale * 16;
            return {
                id: id,
                count: cnt,
                radius: radius,
                community: id,
                communityIndex: 0,
                x: width / 2 + (Math.random() - 0.5) * (width * 0.7),
                y: height / 2 + (Math.random() - 0.5) * (height * 0.7),
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
                n.vx += (centerX - n.x) * p.gravity;
                n.vy += (centerY - n.y) * p.gravity;

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
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;

        ctx.clearRect(0, 0, w, h);
        ctx.save();
        ctx.translate(this.panX, this.panY);
        ctx.scale(this.scale, this.scale);

        // 関連語セット・ターゲット
        const relatedSet = new Set(this.activeRelatedWords.map(w => w.toLowerCase()));
        const targetLower = (this.targetKeyword || '').toLowerCase();

        // 1. エッジ描画
        const maxWeight = Math.max(...this.edges.map(e => e.weight), 1);
        this.edges.forEach(e => {
            const isConnectedToHover = this.hoverNode && (e.source.id === this.hoverNode.id || e.target.id === this.hoverNode.id);
            const alpha = this.hoverNode
                ? (isConnectedToHover ? 0.9 : 0.08)
                : 0.25 + (e.weight / maxWeight) * 0.45;

            const lineWidth = this.hoverNode && isConnectedToHover
                ? Math.min(4.5, 1.5 + (e.weight / maxWeight) * 3.5)
                : Math.min(3, 0.8 + (e.weight / maxWeight) * 2.2);

            ctx.strokeStyle = isConnectedToHover ? '#2563eb' : `rgba(148, 163, 184, ${alpha})`;
            ctx.lineWidth = lineWidth;
            ctx.beginPath();
            ctx.moveTo(e.source.x, e.source.y);
            ctx.lineTo(e.target.x, e.target.y);
            ctx.stroke();
        });

        // 2. ノード描画
        const palette = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#64748b'];
        this.nodes.forEach(node => {
            const isTarget = node.id.toLowerCase() === targetLower;
            const isRelated = relatedSet.has(node.id.toLowerCase());
            const isHover = this.hoverNode && this.hoverNode.id === node.id;

            let fillColor = palette[node.communityIndex % palette.length];
            let strokeColor = '#ffffff';
            let strokeWidth = 2;

            if (isTarget) {
                fillColor = '#e11d48'; // ターゲット: ローズレッド
                strokeColor = '#ffe4e6';
                strokeWidth = 3.5;
            } else if (isRelated) {
                fillColor = '#0284c7'; // 関連語: スカイブルー
                strokeColor = '#e0f2fe';
                strokeWidth = 2.5;
            }

            // 円
            ctx.beginPath();
            ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
            ctx.fillStyle = fillColor;
            ctx.fill();
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = strokeWidth;
            ctx.stroke();

            // ターゲットキーワードの場合は外周リング
            if (isTarget) {
                ctx.beginPath();
                ctx.arc(node.x, node.y, node.radius + 4, 0, Math.PI * 2);
                ctx.strokeStyle = '#f43f5e';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }

            // テキストラベル
            ctx.font = isTarget
                ? 'bold 13px sans-serif'
                : (isRelated ? 'bold 11px sans-serif' : '10px sans-serif');
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';

            const textY = node.y + node.radius + 3;
            // ラベルの背景白ボケ
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 3;
            ctx.strokeText(node.id, node.x, textY);
            ctx.fillStyle = isTarget ? '#9f1239' : (isRelated ? '#0369a1' : '#1e293b');
            ctx.fillText(node.id, node.x, textY);
        });

        ctx.restore();
        this.drawLegend(ctx, w, h);
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

        ctx.restore();
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = NetworkVisualizer;
}
