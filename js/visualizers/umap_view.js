/**
 * UMAP（非線形次元削減）散布図可視化モジュール
 * 高次元の単語共起パターン・意見テキストを2次元多様体空間に射影し、
 * サブテーマや文脈のまとまり（クラスタ）を可視化する
 */
const UmapVisualizer = {
    canvas: null,
    ctx: null,
    points: [], // { id, text, x, y, count, cluster, isTarget, isRelated, rawDoc }
    clusters: [],
    hoverPoint: null,
    scale: 1.0,
    panX: 0,
    panY: 0,
    isPanning: false,
    startX: 0,
    startY: 0,
    viewMode: 'words', // 'words' (単語マップ) または 'docs' (意見マップ)
    targetKeyword: '',
    activeRelatedWords: [],
    onPointClick: null,

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
            this.isPanning = true;
            this.startX = e.clientX - this.panX;
            this.startY = e.clientY - this.panY;
        });

        window.addEventListener('mousemove', (e) => {
            if (!this.canvas) return;
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = (e.clientX - rect.left - this.panX) / this.scale;
            const mouseY = (e.clientY - rect.top - this.panY) / this.scale;

            if (this.isPanning) {
                this.panX = e.clientX - this.startX;
                this.panY = e.clientY - this.startY;
                this.renderFrame();
            } else {
                const hit = this.findPointAt(mouseX, mouseY);
                if (hit !== this.hoverPoint) {
                    this.hoverPoint = hit;
                    this.canvas.style.cursor = hit ? 'pointer' : 'default';
                    this.renderFrame();
                }
            }
        });

        window.addEventListener('mouseup', () => {
            this.isPanning = false;
        });

        c.addEventListener('click', (e) => {
            const rect = c.getBoundingClientRect();
            const mouseX = (e.clientX - rect.left - this.panX) / this.scale;
            const mouseY = (e.clientY - rect.top - this.panY) / this.scale;
            const hit = this.findPointAt(mouseX, mouseY);
            if (hit && typeof this.onPointClick === 'function') {
                this.onPointClick(hit);
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

    findPointAt(x, y) {
        for (let i = this.points.length - 1; i >= 0; i--) {
            const p = this.points[i];
            const dx = p.screenX - x;
            const dy = p.screenY - y;
            const r = (p.radius || 7) + 5;
            if (dx * dx + dy * dy <= r * r) {
                return p;
            }
        }
        return null;
    },

    /**
     * UMAP分析を実行して描画する
     * @param {string} mode - 'words' または 'docs'
     * @param {Array} wordList - 単語リスト
     * @param {object} coocCounts - 共起行列
     * @param {object} docFreq - 文書頻度
     * @param {Array} matchedDocs - 抽出された意見群
     * @param {string} targetKeyword
     * @param {Array<string>} activeRelatedWords
     * @param {object} options
     */
    render(mode, wordList, coocCounts, docFreq, matchedDocs, targetKeyword, activeRelatedWords, options = {}) {
        if (!this.canvas) return;
        this.viewMode = mode || 'words';
        this.targetKeyword = targetKeyword;
        this.activeRelatedWords = activeRelatedWords || [];
        this.onPointClick = options.onPointClick;

        const parentW = this.canvas.parentElement ? this.canvas.parentElement.clientWidth : 0;
        const width = parentW > 50 ? parentW : (this.canvas.clientWidth > 50 ? this.canvas.clientWidth : 800);
        const height = 480;
        this.canvas.width = width;
        this.canvas.height = height;

        this.scale = 1.0;
        this.panX = 0;
        this.panY = 0;

        if (this.viewMode === 'words') {
            this.computeWordUMAP(wordList, coocCounts, docFreq, width, height, options);
        } else {
            this.computeDocUMAP(matchedDocs, wordList, width, height, options);
        }

        this.renderFrame();
    },

    /**
     * 単語ごとのUMAP次元削減
     */
    computeWordUMAP(wordList, coocCounts, docFreq, width, height, options) {
        const maxWords = options.maxWords || 50;
        const topWords = wordList.slice(0, maxWords).map(w => w.text);
        const V = topWords.length;

        if (V === 0) {
            this.points = [];
            return;
        }

        // 類似度行列の構築
        const sim = Array.from({ length: V }, () => new Float64Array(V));
        for (let i = 0; i < V; i++) {
            sim[i][i] = 1.0;
            const w1 = topWords[i];
            const df1 = docFreq[w1] || 1;
            for (let j = i + 1; j < V; j++) {
                const w2 = topWords[j];
                const df2 = docFreq[w2] || 1;
                const key = w1 < w2 ? `${w1}|||${w2}` : `${w2}|||${w1}`;
                const fAB = coocCounts[key] || 0;
                if (fAB > 0) {
                    const denom = Math.sqrt(df1 * df2);
                    const s = denom > 0 ? fAB / denom : 0;
                    sim[i][j] = s;
                    sim[j][i] = s;
                }
            }
        }

        // コサイン距離行列
        const dist = Array.from({ length: V }, () => new Float64Array(V));
        for (let i = 0; i < V; i++) {
            for (let j = i + 1; j < V; j++) {
                let dot = 0, n1 = 0, n2 = 0;
                for (let m = 0; m < V; m++) {
                    dot += sim[i][m] * sim[j][m];
                    n1 += sim[i][m] * sim[i][m];
                    n2 += sim[j][m] * sim[j][m];
                }
                const denom = Math.sqrt(n1) * Math.sqrt(n2);
                const cos = denom > 0 ? dot / denom : 0;
                const d = Math.max(0, Math.min(1.0, 1.0 - cos));
                dist[i][j] = d;
                dist[j][i] = d;
            }
        }

        const Y = this.runUMAPCore(dist, V);
        const kClusters = Math.min(5, Math.max(2, Math.floor(Math.sqrt(V / 2))));
        const clusters = this.runKMeans(Y, kClusters);

        const countsMap = {};
        wordList.forEach(w => { countsMap[w.text] = w.count; });
        const maxC = Math.max(...topWords.map(w => countsMap[w] || 1), 1);
        const minC = Math.min(...topWords.map(w => countsMap[w] || 1), 1);

        const relatedSet = new Set(this.activeRelatedWords.map(w => w.toLowerCase()));
        const targetLower = (this.targetKeyword || '').toLowerCase();

        this.points = topWords.map((word, i) => {
            const cnt = countsMap[word] || 1;
            const rScale = maxC > minC ? (cnt - minC) / (maxC - minC) : 0.5;
            return {
                id: word,
                text: word,
                rawX: Y[i][0],
                rawY: Y[i][1],
                count: cnt,
                radius: 8 + rScale * 14,
                cluster: clusters[i],
                isTarget: word.toLowerCase() === targetLower,
                isRelated: relatedSet.has(word.toLowerCase())
            };
        });

        this.scaleCoordinatesToCanvas(width, height);
    },

    /**
     * 意見（回答文）ごとのUMAP次元削減
     */
    computeDocUMAP(matchedDocs, wordList, width, height, options) {
        const D = matchedDocs.length;
        if (D === 0) {
            this.points = [];
            return;
        }

        // 上位語による文書ベクトル (TF-IDF)
        const featureWords = wordList.slice(0, 40).map(w => w.text);
        const wordIndex = new Map(featureWords.map((w, idx) => [w, idx]));
        const F = featureWords.length;

        const docVectors = matchedDocs.map(doc => {
            const vec = new Float64Array(F);
            const tokens = doc.tokens || [];
            tokens.forEach(t => {
                if (wordIndex.has(t)) {
                    vec[wordIndex.get(t)] += 1;
                }
            });
            // L2正規化
            let norm = 0;
            for (let f = 0; f < F; f++) norm += vec[f] * vec[f];
            norm = Math.sqrt(norm);
            if (norm > 0) {
                for (let f = 0; f < F; f++) vec[f] /= norm;
            }
            return vec;
        });

        // 文書間コサイン距離行列
        const dist = Array.from({ length: D }, () => new Float64Array(D));
        for (let i = 0; i < D; i++) {
            for (let j = i + 1; j < D; j++) {
                let dot = 0;
                for (let f = 0; f < F; f++) dot += docVectors[i][f] * docVectors[j][f];
                const d = Math.max(0, Math.min(1.0, 1.0 - dot));
                dist[i][j] = d;
                dist[j][i] = d;
            }
        }

        const Y = this.runUMAPCore(dist, D);
        const kClusters = Math.min(4, Math.max(2, Math.floor(Math.sqrt(D / 3))));
        const clusters = this.runKMeans(Y, kClusters);

        this.points = matchedDocs.map((doc, i) => {
            const shortText = doc.text.length > 25 ? doc.text.substring(0, 25) + '…' : doc.text;
            return {
                id: `doc_${i}`,
                text: shortText,
                fullText: doc.text,
                attribute: doc.attribute,
                rawX: Y[i][0],
                rawY: Y[i][1],
                radius: 6,
                cluster: clusters[i],
                hasTargetKeyword: doc.hasTargetKeyword,
                matchedWords: doc.matchedWords,
                rawDoc: doc
            };
        });

        this.scaleCoordinatesToCanvas(width, height);
    },

    /**
     * UMAP コアアルゴリズム (高次元ファジィ集合 + SGD最適化)
     */
    runUMAPCore(dist, N) {
        if (N <= 2) {
            return N === 1 ? [[0, 0]] : [[-1, 0], [1, 0]];
        }

        const nNeighbors = Math.max(2, Math.min(12, N - 1));
        const target = Math.log2(nNeighbors);
        const P = Array.from({ length: N }, () => new Float64Array(N));

        for (let i = 0; i < N; i++) {
            const neighbors = [];
            for (let j = 0; j < N; j++) {
                if (i !== j) neighbors.push({ j, d: dist[i][j] });
            }
            neighbors.sort((a, b) => a.d - b.d);
            const knn = neighbors.slice(0, nNeighbors);
            const rho = knn[0].d;

            let lo = 1e-4, hi = 50.0, sigma = 1.0;
            for (let iter = 0; iter < 12; iter++) {
                const mid = (lo + hi) / 2;
                let sum = 0;
                for (let m = 0; m < knn.length; m++) {
                    const diff = Math.max(0, knn[m].d - rho);
                    sum += Math.exp(-diff / mid);
                }
                if (sum > target) hi = mid;
                else lo = mid;
                sigma = mid;
            }

            for (let m = 0; m < knn.length; m++) {
                const diff = Math.max(0, knn[m].d - rho);
                P[i][knn[m].j] = Math.exp(-diff / sigma);
            }
        }

        // 対称化
        const edges = [];
        for (let i = 0; i < N; i++) {
            for (let j = i + 1; j < N; j++) {
                const p_ij = P[i][j] + P[j][i] - P[i][j] * P[j][i];
                if (p_ij > 1e-4) edges.push({ i, j, weight: p_ij });
            }
        }

        // 初期座標（円周上に微小ノイズで配置）
        const Y = [];
        for (let i = 0; i < N; i++) {
            const angle = (2 * Math.PI * i) / N;
            Y.push([
                Math.cos(angle) * 3 + (Math.random() - 0.5) * 0.5,
                Math.sin(angle) * 3 + (Math.random() - 0.5) * 0.5
            ]);
        }

        // SGD 最適化
        const epochs = 120;
        const a = 1.57, b = 0.89; // UMAP標準パラメータ (min_dist=0.1)

        for (let epoch = 0; epoch < epochs; epoch++) {
            const alpha = 1.0 * (1.0 - epoch / epochs);

            for (const edge of edges) {
                const { i, j, weight } = edge;
                if (Math.random() > weight) continue;

                const dx = Y[i][0] - Y[j][0];
                const dy = Y[i][1] - Y[j][1];
                const d2 = dx * dx + dy * dy;

                // 引力
                const gradCoeff = (-2.0 * a * b * Math.pow(Math.max(d2, 1e-4), b - 1.0)) / (1.0 + a * Math.pow(Math.max(d2, 1e-4), b));
                const clipGrad = Math.max(-4.0, Math.min(4.0, gradCoeff));

                Y[i][0] += clipGrad * dx * alpha;
                Y[i][1] += clipGrad * dy * alpha;
                Y[j][0] -= clipGrad * dx * alpha;
                Y[j][1] -= clipGrad * dy * alpha;

                // 負例サンプリング（反発力）
                const k = Math.floor(Math.random() * N);
                if (k !== i) {
                    const rdx = Y[i][0] - Y[k][0];
                    const rdy = Y[i][1] - Y[k][1];
                    const rd2 = rdx * rdx + rdy * rdy;
                    if (rd2 > 1e-4) {
                        const repCoeff = (2.0 * b) / ((0.001 + rd2) * (1.0 + a * Math.pow(rd2, b)));
                        const clipRep = Math.max(-4.0, Math.min(4.0, repCoeff));
                        Y[i][0] += clipRep * rdx * alpha * 0.4;
                        Y[i][1] += clipRep * rdy * alpha * 0.4;
                    }
                }
            }
        }

        return Y;
    },

    runKMeans(points, k) {
        const N = points.length;
        if (N <= k) return points.map((_, i) => i % k);

        // K-Means++風の初期化
        const centroids = [points[0]];
        while (centroids.length < k) {
            const nextIdx = Math.floor(Math.random() * N);
            centroids.push(points[nextIdx]);
        }

        let assignments = new Int32Array(N);
        for (let iter = 0; iter < 12; iter++) {
            // 割り当て
            for (let i = 0; i < N; i++) {
                let minDist = Infinity;
                let bestC = 0;
                for (let c = 0; c < k; c++) {
                    const dx = points[i][0] - centroids[c][0];
                    const dy = points[i][1] - centroids[c][1];
                    const d = dx * dx + dy * dy;
                    if (d < minDist) {
                        minDist = d;
                        bestC = c;
                    }
                }
                assignments[i] = bestC;
            }

            // 重心更新
            const sums = Array.from({ length: k }, () => [0, 0, 0]);
            for (let i = 0; i < N; i++) {
                const c = assignments[i];
                sums[c][0] += points[i][0];
                sums[c][1] += points[i][1];
                sums[c][2] += 1;
            }
            for (let c = 0; c < k; c++) {
                if (sums[c][2] > 0) {
                    centroids[c] = [sums[c][0] / sums[c][2], sums[c][1] / sums[c][2]];
                }
            }
        }

        return assignments;
    },

    scaleCoordinatesToCanvas(width, height) {
        if (this.points.length === 0) return;

        const padX = 70;
        const padY = 60;
        const xs = this.points.map(p => p.rawX);
        const ys = this.points.map(p => p.rawY);

        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minY = Math.min(...ys), maxY = Math.max(...ys);

        const rangeX = maxX - minX || 1;
        const rangeY = maxY - minY || 1;

        const availW = width - padX * 2;
        const availH = height - padY * 2;

        this.points.forEach(p => {
            p.screenX = padX + ((p.rawX - minX) / rangeX) * availW;
            p.screenY = padY + ((p.rawY - minY) / rangeY) * availH;
        });
    },

    renderFrame() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;

        ctx.clearRect(0, 0, w, h);
        ctx.save();
        ctx.translate(this.panX, this.panY);
        ctx.scale(this.scale, this.scale);

        // グリッド線
        ctx.strokeStyle = '#f1f5f9';
        ctx.lineWidth = 1;
        for (let x = 40; x < w; x += 60) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        }
        for (let y = 40; y < h; y += 60) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }

        const palette = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];

        // 各プロットを描画
        this.points.forEach(p => {
            const isHover = this.hoverPoint && this.hoverPoint.id === p.id;
            let fillColor = palette[p.cluster % palette.length];
            let strokeColor = '#ffffff';
            let strokeWidth = 1.5;

            if (p.isTarget || (this.viewMode === 'docs' && p.hasTargetKeyword)) {
                fillColor = '#e11d48'; // ターゲット含む
                strokeColor = '#ffe4e6';
                strokeWidth = 2.5;
            } else if (p.isRelated) {
                fillColor = '#0284c7'; // 関連語
                strokeColor = '#e0f2fe';
                strokeWidth = 2;
            }

            ctx.beginPath();
            ctx.arc(p.screenX, p.screenY, p.radius || 6, 0, Math.PI * 2);
            ctx.fillStyle = fillColor;
            ctx.fill();
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = strokeWidth;
            ctx.stroke();

            // ラベルの描画
            if (this.viewMode === 'words' || isHover) {
                ctx.font = (p.isTarget || isHover) ? 'bold 12px sans-serif' : '10px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';

                const labelY = p.screenY + (p.radius || 6) + 3;
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 3;
                ctx.strokeText(p.text, p.screenX, labelY);
                ctx.fillStyle = p.isTarget ? '#9f1239' : '#1e293b';
                ctx.fillText(p.text, p.screenX, labelY);
            }
        });

        // ホバー時のツールチップ
        if (this.hoverPoint) {
            const hp = this.hoverPoint;
            const tooltipText = this.viewMode === 'docs'
                ? `[意見] ${hp.fullText} ${hp.attribute ? `(${hp.attribute})` : ''}`
                : `[単語] ${hp.text} (出現: ${hp.count}回 / クラスタ ${hp.cluster + 1})`;

            ctx.font = '12px sans-serif';
            const metrics = ctx.measureText(tooltipText);
            const tipW = Math.min(360, metrics.width + 16);
            const tipH = 28;
            const tipX = Math.min(w - tipW - 10, Math.max(10, hp.screenX - tipW / 2));
            const tipY = hp.screenY - (hp.radius || 6) - tipH - 8;

            ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
            ctx.beginPath();
            ctx.roundRect ? ctx.roundRect(tipX, tipY, tipW, tipH, 4) : ctx.rect(tipX, tipY, tipW, tipH);
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            const displayText = metrics.width > 340 ? tooltipText.substring(0, 32) + '…' : tooltipText;
            ctx.fillText(displayText, tipX + 8, tipY + tipH / 2);
        }

        ctx.restore();
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = UmapVisualizer;
}
