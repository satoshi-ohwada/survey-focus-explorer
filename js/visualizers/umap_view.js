/**
 * UMAP（非線形次元削減）散布図可視化モジュール
 * 高次元の単語共起パターン・意見テキストを2次元多様体空間に射影し、
 * サブテーマや文脈のまとまり（クラスタ）を可視化する
 */
const UmapVisualizer = {
    canvas: null,
    ctx: null,
    points: [], // { id, text, screenX, screenY, rawX, rawY, count, radius, cluster, isTarget, isRelated, rawDoc }
    clusters: [],
    clusterHulls: [],
    hoverPoint: null,
    scale: 1.0,
    panX: 0,
    panY: 0,
    isPanning: false,
    startX: 0,
    startY: 0,
    viewMode: 'words', // 'words' (単語マップ) または 'docs' (意見マップ)
    spreadMode: 'wide', // 'normal' | 'wide' | 'widest'
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
        this.scale = this.spreadMode === 'widest' ? 0.75 : (this.spreadMode === 'wide' ? 0.85 : 0.95);
        this.panX = (width * (1 - this.scale)) / 2;
        this.panY = (height * (1 - this.scale)) / 2;
        this.renderFrame();
    },

    findPointAt(x, y) {
        for (let i = this.points.length - 1; i >= 0; i--) {
            const p = this.points[i];
            const dx = p.screenX - x;
            const dy = p.screenY - y;
            const r = (p.radius || 7) + 6;
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
    /**
     * 単語がターゲットキーワード（または代表複合語・派生語）かどうか判定
     * @param {string} word 
     * @returns {boolean}
     */
    isTargetWord(word) {
        if (!word) return false;
        const wLower = word.toLowerCase();
        const tLower = (this.targetKeyword || '').toLowerCase();
        const rLower = (this.resolvedTargetWord || '').toLowerCase();
        if (wLower === tLower || wLower === rLower) return true;
        if (tLower && (wLower.includes(tLower) || tLower.includes(wLower))) return true;
        return false;
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
        this.resolvedTargetWord = options.resolvedTargetWord || targetKeyword;
        this.activeRelatedWords = activeRelatedWords || [];
        this.onPointClick = options.onPointClick;
        this.spreadMode = options.spreadMode || 'wide'; // 'normal' | 'wide' | 'widest'
        this.fontSize = options.fontSize || 'large'; // 'normal' | 'large' | 'xlarge'

        const parentW = this.canvas.parentElement ? this.canvas.parentElement.clientWidth : 0;
        const width = Math.min(960, parentW > 50 ? parentW : 960);
        const height = 600;
        this.canvas.width = width;
        this.canvas.height = height;

        this.scale = 0.92;
        this.panX = (width * (1 - this.scale)) / 2;
        this.panY = (height * (1 - this.scale)) / 2;

        if (this.viewMode === 'words') {
            this.computeWordUMAP(wordList, coocCounts, docFreq, matchedDocs, width, height, options);
        } else {
            this.computeDocUMAP(matchedDocs, wordList, width, height, options);
        }

        this.renderFrame();
    },

    /**
     * 単語ごとのUMAP次元削減
     * 回答文書プロファイル＋共起のハイブリッド特徴量により1点縮退を防止
     */
    computeWordUMAP(wordList, coocCounts, docFreq, matchedDocs, width, height, options) {
        const maxWords = options.maxWords || 50;
        let topWords = wordList.slice(0, maxWords).map(w => w.text);

        // 代表ターゲット語（中東情勢など）およびキーワードがもしwordListにあれば、topWordsに確実に含める
        const targetToEnsure = [this.resolvedTargetWord, this.targetKeyword].filter(w => w && wordList.some(item => item.text === w));
        for (const tw of targetToEnsure) {
            if (!topWords.includes(tw)) {
                if (topWords.length >= maxWords) topWords.pop();
                topWords.unshift(tw);
            }
        }
        // もし完全一致がなく、ターゲットを含む単語があればそれを確実に含める
        if (!topWords.some(w => this.isTargetWord(w))) {
            const found = wordList.find(item => this.isTargetWord(item.text));
            if (found && !topWords.includes(found.text)) {
                if (topWords.length >= maxWords) topWords.pop();
                topWords.unshift(found.text);
            }
        }

        const V = topWords.length;

        if (V === 0) {
            this.points = [];
            return;
        }

        const D = (matchedDocs && matchedDocs.length) ? matchedDocs.length : 1;
        const wordIndex = new Map(topWords.map((w, i) => [w, i]));

        // 1. 各単語の高次元特徴ベクトルの構築 (文書プロファイル D次元 + 共起プロファイル V次元)
        const featureDim = D + V;
        const wordVectors = Array.from({ length: V }, () => new Float64Array(featureDim));

        // 1-1. 文書出現プロファイル (各回答におけるTF-IDF重み)
        if (matchedDocs && matchedDocs.length > 0) {
            matchedDocs.forEach((doc, dIdx) => {
                const tokens = doc.tokens || [];
                const countsInDoc = {};
                tokens.forEach(t => {
                    if (wordIndex.has(t)) {
                        countsInDoc[t] = (countsInDoc[t] || 0) + 1;
                    }
                });
                Object.entries(countsInDoc).forEach(([w, cnt]) => {
                    const wIdx = wordIndex.get(w);
                    const df = docFreq[w] || 1;
                    const idf = Math.log((D + 1) / (df + 0.5)) + 1;
                    wordVectors[wIdx][dIdx] = cnt * idf;
                });
            });
        }

        // 1-2. 共起プロファイル (上位単語同士の共起強度)
        for (let i = 0; i < V; i++) {
            const w1 = topWords[i];
            const df1 = docFreq[w1] || 1;
            for (let j = i + 1; j < V; j++) {
                const w2 = topWords[j];
                const df2 = docFreq[w2] || 1;
                const key = w1 < w2 ? `${w1}|||${w2}` : `${w2}|||${w1}`;
                const fAB = coocCounts[key] || 0;
                if (fAB > 0) {
                    const weight = fAB / Math.sqrt(df1 * df2);
                    wordVectors[i][D + j] = weight;
                    wordVectors[j][D + i] = weight;
                }
            }
        }

        // L2正規化
        for (let i = 0; i < V; i++) {
            let norm = 0;
            for (let f = 0; f < featureDim; f++) norm += wordVectors[i][f] * wordVectors[i][f];
            norm = Math.sqrt(norm);
            if (norm > 0) {
                for (let f = 0; f < featureDim; f++) wordVectors[i][f] /= norm;
            }
        }

        // 2. コサイン距離行列の構築
        const dist = Array.from({ length: V }, () => new Float64Array(V));
        for (let i = 0; i < V; i++) {
            for (let j = i + 1; j < V; j++) {
                let dot = 0;
                for (let f = 0; f < featureDim; f++) {
                    dot += wordVectors[i][f] * wordVectors[j][f];
                }
                // 微小なジッターを加えて完全同一点への縮退を物理的に防止
                const cosSim = Math.max(-1.0, Math.min(1.0, dot));
                const d = Math.max(0.01, 1.0 - cosSim);
                dist[i][j] = d;
                dist[j][i] = d;
            }
        }

        // 3. PCA初期化 + UMAPによる2次元最適化
        const Y = this.runUMAPCore(dist, V, wordVectors);

        const countsMap = {};
        wordList.forEach(w => { countsMap[w.text] = w.count; });
        const maxC = Math.max(...topWords.map(w => countsMap[w] || 1), 1);
        const minC = Math.min(...topWords.map(w => countsMap[w] || 1), 1);

        const relatedSet = new Set(this.activeRelatedWords.map(w => w.toLowerCase()));

        this.points = topWords.map((word, i) => {
            const cnt = countsMap[word] || 1;
            const rScale = maxC > minC ? (cnt - minC) / (maxC - minC) : 0.5;
            const isTarget = this.isTargetWord(word);
            return {
                id: word,
                text: word,
                rawX: Y[i][0],
                rawY: Y[i][1],
                screenX: 0,
                screenY: 0,
                count: cnt,
                radius: 8 + rScale * 14,
                cluster: 0,
                isTarget: isTarget,
                isRelated: relatedSet.has(word.toLowerCase())
            };
        });

        // 4. キャンバス座標スケーリング ＆ デクラスタリング（適度な重なり防止）
        this.scaleCoordinatesToCanvas(width, height);
        this.relaxPoints(width, height);

        // 5. 確定した2次元平面座標に対して、高精度 K-Means++ クラスタリングを実行
        const kClusters = Math.min(5, Math.max(2, Math.floor(Math.sqrt(V / 2.5))));
        const clusters = this.runKMeans(this.points, kClusters);
        this.points.forEach((p, idx) => {
            p.cluster = clusters[idx];
        });

        // 6. クラスタ背景ハローおよび代表ラベルの算出
        this.calculateClusterHulls();
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
        const featureWords = wordList.slice(0, 50).map(w => w.text);
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
                const d = Math.max(0.01, 1.0 - Math.min(1.0, dot));
                dist[i][j] = d;
                dist[j][i] = d;
            }
        }

        const Y = this.runUMAPCore(dist, D, docVectors);

        this.points = matchedDocs.map((doc, i) => {
            const shortText = doc.text.length > 25 ? doc.text.substring(0, 25) + '…' : doc.text;
            return {
                id: `doc_${i}`,
                text: shortText,
                fullText: doc.text,
                attribute: doc.attribute,
                rawX: Y[i][0],
                rawY: Y[i][1],
                screenX: 0,
                screenY: 0,
                radius: 6,
                cluster: 0,
                hasTargetKeyword: doc.hasTargetKeyword,
                matchedWords: doc.matchedWords,
                rawDoc: doc
            };
        });

        this.scaleCoordinatesToCanvas(width, height);
        this.relaxPoints(width, height);

        const kClusters = Math.min(5, Math.max(2, Math.floor(Math.sqrt(D / 2.5))));
        const clusters = this.runKMeans(this.points, kClusters);
        this.points.forEach((p, idx) => {
            p.cluster = clusters[idx];
        });

        this.calculateClusterHulls();
    },

    /**
     * UMAP コアアルゴリズム (PCA初期化 + 高次元ファジィ単体 + 反発力強化SGD)
     */
    runUMAPCore(dist, N, vectors = null) {
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

        // 初期座標: PCA/MDS 2次元射影による大域配置（ランダムの代わりに構造を保持）
        const Y = this.initializePCA(N, dist, vectors);

        // SGD 最適化パラメータ（min_dist を大きめにして密集・1点縮退を防止）
        const epochs = 150;
        const a = 0.85, b = 0.72; // min_dist ≈ 0.4 相当の緩やかな反発プロファイル

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
                const clipGrad = Math.max(-3.0, Math.min(3.0, gradCoeff));

                Y[i][0] += clipGrad * dx * alpha;
                Y[i][1] += clipGrad * dy * alpha;
                Y[j][0] -= clipGrad * dx * alpha;
                Y[j][1] -= clipGrad * dy * alpha;

                // 負例サンプリング（反発力） - 4回サンプリングで分散を促進
                for (let rep = 0; rep < 4; rep++) {
                    const k = Math.floor(Math.random() * N);
                    if (k !== i) {
                        const rdx = Y[i][0] - Y[k][0];
                        const rdy = Y[i][1] - Y[k][1];
                        const rd2 = rdx * rdx + rdy * rdy;
                        if (rd2 > 1e-4) {
                            const repCoeff = (2.0 * b) / ((0.005 + rd2) * (1.0 + a * Math.pow(rd2, b)));
                            const clipRep = Math.max(-3.0, Math.min(3.0, repCoeff));
                            Y[i][0] += clipRep * rdx * alpha * 0.5;
                            Y[i][1] += clipRep * rdy * alpha * 0.5;
                        }
                    }
                }
            }
        }

        return Y;
    },

    /**
     * 古典的MDS / PCAによる大域的2次元初期配置
     */
    initializePCA(N, dist, vectors) {
        const Y = [];
        if (vectors && vectors.length === N && vectors[0].length >= 2) {
            // ベクトルから第1・第2主成分方向の簡易射影
            const dim = vectors[0].length;
            const means = new Float64Array(dim);
            for (let i = 0; i < N; i++) {
                for (let d = 0; d < dim; d++) means[d] += vectors[i][d];
            }
            for (let d = 0; d < dim; d++) means[d] /= N;

            // 簡易2軸プロジェクション（分散の大きい軸）
            for (let i = 0; i < N; i++) {
                let x = 0, y = 0;
                for (let d = 0; d < Math.min(dim, 15); d++) {
                    const val = vectors[i][d] - means[d];
                    x += val * Math.cos((d * Math.PI) / 6);
                    y += val * Math.sin((d * Math.PI) / 6);
                }
                const noise = (Math.random() - 0.5) * 0.2;
                Y.push([x * 4 + noise, y * 4 + noise]);
            }
        } else {
            // 古典的円周＋ノイズ配置
            for (let i = 0; i < N; i++) {
                const angle = (2 * Math.PI * i) / N;
                Y.push([
                    Math.cos(angle) * 3 + (Math.random() - 0.5) * 0.5,
                    Math.sin(angle) * 3 + (Math.random() - 0.5) * 0.5
                ]);
            }
        }
        return Y;
    },

    /**
     * K-Means++ アルゴリズムによる高精度クラスタリング
     * @param {Array<object>} points - [{ screenX, screenY }, ...]
     * @param {number} k - クラスタ数
     * @returns {Int32Array} 各点のクラスタID
     */
    runKMeans(points, k) {
        const N = points.length;
        if (N <= k) return new Int32Array(points.map((_, i) => i % k));

        // 1. K-Means++ 中心点初期化 (距離の2乗に比例して離れた点を決定論的・高品質に選出)
        const centroids = [];
        centroids.push([points[0].screenX, points[0].screenY]);

        for (let c = 1; c < k; c++) {
            const dists = new Float64Array(N);
            let totalD2 = 0;
            for (let i = 0; i < N; i++) {
                let minD = Infinity;
                for (let m = 0; m < centroids.length; m++) {
                    const dx = points[i].screenX - centroids[m][0];
                    const dy = points[i].screenY - centroids[m][1];
                    const d2 = dx * dx + dy * dy;
                    if (d2 < minD) minD = d2;
                }
                dists[i] = minD;
                totalD2 += minD;
            }

            // 最も離れた候補を優先選出
            let threshold = Math.random() * totalD2;
            let chosenIdx = N - 1;
            for (let i = 0; i < N; i++) {
                threshold -= dists[i];
                if (threshold <= 0) {
                    chosenIdx = i;
                    break;
                }
            }
            centroids.push([points[chosenIdx].screenX, points[chosenIdx].screenY]);
        }

        // 2. 最適化イテレーション (20回)
        const assignments = new Int32Array(N);
        for (let iter = 0; iter < 20; iter++) {
            let changed = false;
            for (let i = 0; i < N; i++) {
                let minDist = Infinity;
                let bestC = 0;
                for (let c = 0; c < k; c++) {
                    const dx = points[i].screenX - centroids[c][0];
                    const dy = points[i].screenY - centroids[c][1];
                    const d = dx * dx + dy * dy;
                    if (d < minDist) {
                        minDist = d;
                        bestC = c;
                    }
                }
                if (assignments[i] !== bestC) {
                    assignments[i] = bestC;
                    changed = true;
                }
            }
            if (!changed) break;

            const sums = Array.from({ length: k }, () => [0, 0, 0]);
            for (let i = 0; i < N; i++) {
                const c = assignments[i];
                sums[c][0] += points[i].screenX;
                sums[c][1] += points[i].screenY;
                sums[c][2] += 1;
            }
            for (let c = 0; c < k; c++) {
                if (sums[c][2] > 0) {
                    centroids[c] = [sums[c][0] / sums[c][2], sums[c][1] / sums[c][2]];
                }
            }
        }

        // 3. 視覚的調和のためのクラスタID並べ替え（X座標+Y座標順にソートして左上から右下へ整列）
        const clusterCenters = Array.from({ length: k }, (_, c) => {
            let cx = 0, cy = 0, count = 0;
            for (let i = 0; i < N; i++) {
                if (assignments[i] === c) {
                    cx += points[i].screenX;
                    cy += points[i].screenY;
                    count++;
                }
            }
            return {
                originalCluster: c,
                cx: count > 0 ? cx / count : 0,
                cy: count > 0 ? cy / count : 0
            };
        });

        clusterCenters.sort((a, b) => (a.cx + a.cy * 0.4) - (b.cx + b.cy * 0.4));
        const remap = new Map(clusterCenters.map((item, newIdx) => [item.originalCluster, newIdx]));

        for (let i = 0; i < N; i++) {
            assignments[i] = remap.get(assignments[i]);
        }

        return assignments;
    },

    scaleCoordinatesToCanvas(width, height) {
        if (this.points.length === 0) return;

        const padX = 80;
        const padY = 70;
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

    /**
     * デクラスタリング・リラクゼーション（重なり防止＆適正間隔の確保）
     */
    relaxPoints(width, height) {
        const N = this.points.length;
        if (N <= 1) return;

        const pad = 40;
        const spacingParams = {
            normal: { minDist: 38, steps: 60 },
            wide:   { minDist: 50, steps: 75 },
            widest: { minDist: 66, steps: 90 }
        };
        const cfg = spacingParams[this.spreadMode] || spacingParams.wide;

        for (let s = 0; s < cfg.steps; s++) {
            let hasCollision = false;
            for (let i = 0; i < N; i++) {
                const p1 = this.points[i];
                for (let j = i + 1; j < N; j++) {
                    const p2 = this.points[j];
                    let dx = p2.screenX - p1.screenX;
                    let dy = p2.screenY - p1.screenY;
                    let dist = Math.sqrt(dx * dx + dy * dy);

                    if (dist < 0.1) {
                        const angle = ((i * 37 + j * 73) % 360) * (Math.PI / 180);
                        dx = Math.cos(angle) * 1.5;
                        dy = Math.sin(angle) * 1.5;
                        dist = 1.5;
                    }

                    const reqDist = (p1.radius || 8) + (p2.radius || 8) + cfg.minDist;
                    if (dist < reqDist) {
                        const overlap = (reqDist - dist) * 0.5;
                        const ox = (dx / dist) * overlap * 0.32;
                        const oy = (dy / dist) * overlap * 0.32;
                        p1.screenX -= ox;
                        p1.screenY -= oy;
                        p2.screenX += ox;
                        p2.screenY += oy;
                        hasCollision = true;
                    }
                }
                p1.screenX = Math.max(pad, Math.min(width - pad, p1.screenX));
                p1.screenY = Math.max(pad, Math.min(height - pad, p1.screenY));
            }
            if (!hasCollision && s > 25) break;
        }
    },

    /**
     * 各クラスタの重心と広がり、代表キーワード（トピックハロー用）を算出
     */
    calculateClusterHulls() {
        const clusterMap = new Map();
        this.points.forEach(p => {
            if (!clusterMap.has(p.cluster)) {
                clusterMap.set(p.cluster, []);
            }
            clusterMap.get(p.cluster).push(p);
        });

        this.clusterHulls = [];
        clusterMap.forEach((pts, cIdx) => {
            if (pts.length === 0) return;
            const cx = pts.reduce((s, p) => s + p.screenX, 0) / pts.length;
            const cy = pts.reduce((s, p) => s + p.screenY, 0) / pts.length;

            let maxR = 0;
            pts.forEach(p => {
                const d = Math.sqrt((p.screenX - cx) ** 2 + (p.screenY - cy) ** 2);
                if (d > maxR) maxR = d;
            });

            // クラスタ内の代表単語（出現回数順トップ2）
            const sortedWords = [...pts].sort((a, b) => (b.count || 0) - (a.count || 0));
            const topKws = sortedWords.slice(0, 2).map(p => p.text);

            this.clusterHulls.push({
                cluster: cIdx,
                cx: cx,
                cy: cy,
                radius: Math.max(38, Math.min(180, maxR + 24)),
                label: topKws.length > 0 ? topKws.join('・') : `グループ ${cIdx + 1}`
            });
        });
    },

    renderFrame() {
        if (!this.ctx || !this.canvas) return;
        this.renderToContext(this.ctx, this.canvas.width, this.canvas.height, this.scale, this.panX, this.panY, false);
    },

    /**
     * 指定のコンテキストにUMAP散布図を描画
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

        // 1. グリッド線
        ctx.strokeStyle = '#f1f5f9';
        ctx.lineWidth = 1;
        for (let x = 40; x < w; x += 60) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        }
        for (let y = 40; y < h; y += 60) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }

        // 統一感のある美しいクラスタパレット（青、緑、琥珀、紫、ピンク、ティール）
        const palette = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4'];

        // 2. クラスタごとの背景ハロー（話題グループのまとまり・島を可視化）
        this.clusterHulls.forEach(hull => {
            const color = palette[hull.cluster % palette.length];
            ctx.save();
            ctx.beginPath();
            ctx.arc(hull.cx, hull.cy, hull.radius, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.globalAlpha = 0.07;
            ctx.fill();

            ctx.strokeStyle = color;
            ctx.globalAlpha = 0.22;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([5, 4]);
            ctx.stroke();

            // トピックラベル（ハローの上部に淡く表示）
            ctx.globalAlpha = 0.55;
            ctx.font = 'bold 12px sans-serif';
            ctx.fillStyle = color;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(`トピック ${hull.cluster + 1} (${hull.label})`, hull.cx, hull.cy - hull.radius + 2);
            ctx.restore();
        });

        // 3. 各プロット（点）およびラベルの描画
        this.points.forEach(p => {
            const isHover = !isExport && this.hoverPoint && this.hoverPoint.id === p.id;

            // 基本色は必ず「クラスタ色（空間の同一色）」を適用してまとまりを表現！
            const clusterColor = palette[p.cluster % palette.length];
            let fillColor = clusterColor;
            let strokeColor = '#ffffff';
            let strokeWidth = 2.0;

            const isTarget = p.isTarget || (this.viewMode === 'docs' && p.hasTargetKeyword);
            const isRelated = p.isRelated && !isTarget;

            if (isTarget) {
                fillColor = '#e11d48'; // ターゲット中心語のみ特別なローズレッド
                strokeColor = '#ffffff';
                strokeWidth = 2.8;
            }

            // ノード本体の円
            ctx.beginPath();
            ctx.arc(p.screenX, p.screenY, p.radius || 6, 0, Math.PI * 2);
            ctx.fillStyle = fillColor;
            ctx.fill();
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = strokeWidth;
            ctx.stroke();

            // ターゲット中心語の外側発光リング（二重丸）
            if (isTarget) {
                ctx.beginPath();
                ctx.arc(p.screenX, p.screenY, (p.radius || 6) + 4.5, 0, Math.PI * 2);
                ctx.strokeStyle = '#e11d48';
                ctx.lineWidth = 2.2;
                ctx.stroke();
            }

            // 関連語の外側アクセントリング（スカイブルー点線リングで品よく関連性を明示）
            if (isRelated) {
                ctx.beginPath();
                ctx.arc(p.screenX, p.screenY, (p.radius || 6) + 3.5, 0, Math.PI * 2);
                ctx.strokeStyle = '#0284c7';
                ctx.lineWidth = 2.0;
                ctx.setLineDash([3, 2]);
                ctx.stroke();
                ctx.setLineDash([]);
            }

            // 単語ラベルの描画（白背景角丸ピル）
            if (this.viewMode === 'words' || isHover || isExport) {
                const fontSizes = {
                    normal: { target: 13, related: 12, other: 11 },
                    large:   { target: 16, related: 14.5, other: 13 },
                    xlarge:  { target: 19, related: 17, other: 15.5 }
                };
                const fCfg = fontSizes[this.fontSize] || fontSizes.large;
                const fSize = (isTarget || isHover) ? fCfg.target : (isRelated ? fCfg.related : fCfg.other);
                const isBold = isTarget || isRelated || isHover;

                ctx.font = `${isBold ? 'bold ' : ''}${fSize}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';

                const labelPrefix = isTarget ? '🎯 ' : (isRelated ? '◆ ' : '');
                const labelText = labelPrefix + p.text;
                const metrics = ctx.measureText(labelText);
                const textWidth = metrics.width;
                const pad = Math.max(5, Math.round(fSize * 0.35));
                const boxW = textWidth + pad * 2;
                const boxH = Math.round(fSize * 1.35) + 4;
                const boxX = p.screenX - boxW / 2;
                const boxY = p.screenY + (p.radius || 6) + 4;

                // 背景ピルのボーダー色（クラスタ色またはハイライト色）
                let pillBorder = clusterColor;
                if (isTarget || isHover) pillBorder = '#e11d48';
                else if (isRelated) pillBorder = '#0284c7';

                ctx.save();
                ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
                ctx.strokeStyle = pillBorder;
                ctx.lineWidth = (isTarget || isHover || isRelated) ? 1.6 : 1.0;
                ctx.beginPath();
                ctx.roundRect
                    ? ctx.roundRect(boxX, boxY, boxW, boxH, 4)
                    : ctx.rect(boxX, boxY, boxW, boxH);
                ctx.fill();
                ctx.stroke();
                ctx.restore();

                // テキスト本体の色
                ctx.fillStyle = isTarget ? '#9f1239' : (isRelated ? '#0369a1' : (isHover ? '#0f172a' : '#1e293b'));
                ctx.fillText(labelText, p.screenX, boxY + 2.5);
            }
        });

        // 4. ホバー時のツールチップ（画面表示時のみ）
        if (!isExport && this.hoverPoint) {
            const hp = this.hoverPoint;
            const tooltipText = this.viewMode === 'docs'
                ? `[意見] ${hp.fullText} ${hp.attribute ? `(${hp.attribute})` : ''}`
                : `[単語] ${hp.text} (出現: ${hp.count}回 / クラスタ ${hp.cluster + 1})`;

            ctx.font = '12px sans-serif';
            const metrics = ctx.measureText(tooltipText);
            const tipW = Math.min(380, metrics.width + 18);
            const tipH = 28;
            const tipX = Math.min(w - tipW - 10, Math.max(10, hp.screenX - tipW / 2));
            const tipY = hp.screenY - (hp.radius || 6) - tipH - 8;

            ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
            ctx.beginPath();
            ctx.roundRect ? ctx.roundRect(tipX, tipY, tipW, tipH, 4) : ctx.rect(tipX, tipY, tipW, tipH);
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            const displayText = metrics.width > 360 ? tooltipText.substring(0, 34) + '…' : tooltipText;
            ctx.fillText(displayText, tipX + 9, tipY + tipH / 2);
        }

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
        if (!this.points || this.points.length === 0) return null;

        // 点群およびラベルのバウンディングボックスを計算
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        this.points.forEach(p => {
            const padX = (p.radius || 6) + Math.max(22, (p.text || '').length * 8.5);
            const padY = (p.radius || 6) + 32;
            if (p.screenX - padX < minX) minX = p.screenX - padX;
            if (p.screenX + padX > maxX) maxX = p.screenX + padX;
            if (p.screenY - padY < minY) minY = p.screenY - padY;
            if (p.screenY + padY > maxY) maxY = p.screenY + padY;
        });

        // クラスタハローの範囲も考慮
        this.clusterHulls.forEach(h => {
            if (h.cx - h.radius < minX) minX = h.cx - h.radius;
            if (h.cx + h.radius > maxX) maxX = h.cx + h.radius;
            if (h.cy - h.radius < minY) minY = h.cy - h.radius;
            if (h.cy + h.radius > maxY) maxY = h.cy + h.radius;
        });

        const bboxW = Math.max(100, maxX - minX);
        const bboxH = Math.max(100, maxY - minY);

        // 周囲マージン（左右50px、上下60px）
        const marginX = 50;
        const marginY = 60;
        const availW = targetW - marginX * 2;
        const availH = targetH - marginY * 2;

        const autoScale = Math.min(availW / bboxW, availH / bboxH);

        const bboxCenterX = (minX + maxX) / 2;
        const bboxCenterY = (minY + maxY) / 2;

        const autoPanX = targetW / 2 - bboxCenterX * autoScale;
        const autoPanY = targetH / 2 - bboxCenterY * autoScale;

        // 1200x900 のオフスクリーンキャンバスに白背景で描画
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = targetW;
        exportCanvas.height = targetH;
        const ctx = exportCanvas.getContext('2d');

        this.renderToContext(ctx, targetW, targetH, autoScale, autoPanX, autoPanY, true);
        return exportCanvas;
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = UmapVisualizer;
}
