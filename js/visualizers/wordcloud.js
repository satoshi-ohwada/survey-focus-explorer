/**
 * ワードクラウド可視化モジュール
 * wordcloud2.js を使用して抽出意見の重要単語を描画
 */
const WordCloudVisualizer = {
    canvas: null,
    currentWords: [],
    targetKeyword: '',
    activeRelatedWords: [],

    init(canvasId) {
        this.canvas = document.getElementById(canvasId);
    },

    /**
     * ワードクラウドを描画する
     * @param {Array<{text: string, count: number, tfidf: number}>} wordList
     * @param {string} targetKeyword
     * @param {Array<string>} activeRelatedWords
     * @param {object} options
     */
    render(wordList, targetKeyword, activeRelatedWords, options = {}) {
        if (!this.canvas) return;
        this.currentWords = wordList;
        this.targetKeyword = targetKeyword;
        this.activeRelatedWords = activeRelatedWords || [];

        const rankingMethod = options.rankingMethod || 'count'; // 'count' or 'tfidf'
        const maxWords = parseInt(options.maxWords, 10) || 60;
        const shape = options.shape || 'circle'; // 'circle' (雲形) or 'square' (長方形)
        this.lastRanking = rankingMethod;
        this.lastMaxWords = maxWords;
        this.lastShape = shape;

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

        const filtered = wordList.slice(0, maxWords);
        if (filtered.length === 0) {
            const ctx = this.canvas.getContext('2d');
            ctx.clearRect(0, 0, width, height);
            ctx.fillStyle = '#64748b';
            ctx.font = '16px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('表示可能な単語がありません', width / 2, height / 2);
            return;
        }

        // キャンバス領域に対して最大限大きく美しく広がるフォントサイズを動的計算
        const { list } = this.calculateFontSizes(filtered, width, height, rankingMethod, shape);

        this.resolvedTargetWord = options.resolvedTargetWord || targetKeyword;
        const relatedSet = new Set(this.activeRelatedWords.map(w => w.toLowerCase()));
        const targetLower = (this.targetKeyword || '').toLowerCase();
        const resolvedLower = (this.resolvedTargetWord || '').toLowerCase();

        // 単語の色分けルール
        const colorCallback = (word) => {
            const lower = word.toLowerCase();
            if (lower === targetLower || lower === resolvedLower || (targetLower && (lower.includes(targetLower) || targetLower.includes(lower)))) {
                return '#e11d48'; // 注目キーワード / 代表複合語: 鮮やかなローズレッド
            }
            if (relatedSet.has(lower)) {
                return '#0284c7'; // 関連語: スカイブルー
            }
            // 一般重要語: 深みのあるインディゴ/スレート系のグラデーション
            const colors = ['#3b82f6', '#6366f1', '#4f46e5', '#2563eb', '#0d9488'];
            const idx = Math.abs(this.hashCode(word)) % colors.length;
            return colors[idx];
        };

        const isSquare = (shape === 'square' || shape === 'rect');
        const cloudShape = isSquare ? 'square' : 'circle';
        // 矩形時はキャンバス比率（4:3なら約0.75）、雲形時は自然な広がりを生む0.65
        const ellipticity = isSquare ? (height / width) : 0.65;

        if (typeof WordCloud === 'function') {
            WordCloud(this.canvas, {
                list: list,
                gridSize: Math.max(6, Math.round(8 * (width / 960))),
                weightFactor: 1,
                fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "BIZ UDPGothic", "Hiragino Kaku Gothic ProN", sans-serif',
                color: colorCallback,
                backgroundColor: '#ffffff',
                shape: cloudShape,
                ellipticity: ellipticity,
                rotateRatio: 0,
                rotationSteps: 0,
                minRotation: 0,
                maxRotation: 0,
                shuffle: false,
                drawOutOfBound: false,
                shrinkToFit: true,
                click: (item) => {
                    if (item && item[0] && typeof options.onWordClick === 'function') {
                        options.onWordClick(item[0]);
                    }
                }
            });
        }
    },

    /**
     * キャンバス領域に対してワードクラウドが最大かつ美しく広がる最適なフォントサイズを動的計算
     * 単語群全体の合計面積と形状目標充填率から理想サイズを逆算
     * @param {Array} filtered
     * @param {number} width
     * @param {number} height
     * @param {string} rankingMethod
     * @param {string} shape
     * @returns {{minFont: number, maxFont: number, list: Array}}
     */
    calculateFontSizes(filtered, width, height, rankingMethod, shape) {
        if (!filtered || filtered.length === 0) {
            return { minFont: 14, maxFont: 40, list: [] };
        }

        const isSquare = (shape === 'square' || shape === 'rect');
        // 領域充填率目標: 単語間の適度なスペースと視認性を両立（長方形 0.63、雲形 0.52）
        const targetFill = isSquare ? 0.63 : 0.52;
        const targetArea = (width * height) * targetFill;

        const maxVal = Math.max(...filtered.map(w => rankingMethod === 'tfidf' ? w.tfidf : w.count));
        const minVal = Math.min(...filtered.map(w => rankingMethod === 'tfidf' ? w.tfidf : w.count));
        const valRange = maxVal > minVal ? (maxVal - minVal) : 1;

        const count = filtered.length;
        // 単語数に応じた主役単語（最大値）と一般単語（最小値）のフォント比率
        const maxRatio = count <= 25 ? 4.2 : (count <= 60 ? 3.6 : 2.8);

        let sumNormalizedArea = 0;
        const normalizedItems = filtered.map(item => {
            const val = rankingMethod === 'tfidf' ? item.tfidf : item.count;
            const weight = maxVal > minVal ? (val - minVal) / valRange : 0.5;
            const len = Math.max(1, (item.text || '').length);
            const factor = 1 + weight * (maxRatio - 1);
            sumNormalizedArea += len * factor * factor * 1.05;
            return { item, weight, factor };
        });

        // 目標面積から理想の最小フォントサイズを逆算
        let optimalMinFont = Math.sqrt(targetArea / Math.max(1, sumNormalizedArea));
        let optimalMaxFont = optimalMinFont * maxRatio;

        // キャンバスの物理境界に対する上限クランプ（文字がキャンバス自体からはみ出ないように）
        const maxAllowedFont = Math.min(width * 0.28, height * 0.26);
        if (optimalMaxFont > maxAllowedFont) {
            const scale = maxAllowedFont / optimalMaxFont;
            optimalMaxFont = maxAllowedFont;
            optimalMinFont *= scale;
        }

        // 下限クランプ（可読性の維持）
        const minAllowedFont = Math.max(11, Math.round(height * 0.02));
        if (optimalMinFont < minAllowedFont) {
            optimalMinFont = minAllowedFont;
        }

        const fontRange = Math.max(8, optimalMaxFont - optimalMinFont);

        const list = normalizedItems.map(({ item, weight }) => {
            const size = Math.round(optimalMinFont + weight * fontRange);
            return [item.text, size, item];
        });

        return {
            minFont: Math.round(optimalMinFont),
            maxFont: Math.round(optimalMaxFont),
            list
        };
    },

    /**
     * 資料向け高解像度・オートフィット（最大化＆中央配置）キャンバスを取得
     * PowerPoint/Wordでの利用を想定した4:3比率 (1200x900)
     * @param {number} [targetW=1200]
     * @param {number} [targetH=900]
     * @returns {Promise<HTMLCanvasElement|null>}
     */
    async getExportCanvas(targetW = 1200, targetH = 900) {
        if (!this.currentWords || this.currentWords.length === 0) return null;

        const maxWords = this.lastMaxWords || 60;
        const filtered = this.currentWords.slice(0, maxWords);
        if (filtered.length === 0) return null;

        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = targetW;
        exportCanvas.height = targetH;

        const rankingMethod = this.lastRanking || 'count';
        const shape = this.lastShape || 'circle';

        // エクスポート用キャンバスでも最大フィット計算を適用
        const { list } = this.calculateFontSizes(filtered, targetW, targetH, rankingMethod, shape);

        const relatedSet = new Set(this.activeRelatedWords.map(w => w.toLowerCase()));
        const targetLower = (this.targetKeyword || '').toLowerCase();
        const resolvedLower = (this.resolvedTargetWord || '').toLowerCase();

        const colorCallback = (word) => {
            const lower = word.toLowerCase();
            if (lower === targetLower || lower === resolvedLower || (targetLower && (lower.includes(targetLower) || targetLower.includes(lower)))) {
                return '#e11d48';
            }
            if (relatedSet.has(lower)) {
                return '#0284c7';
            }
            const colors = ['#3b82f6', '#6366f1', '#4f46e5', '#2563eb', '#0d9488'];
            const idx = Math.abs(this.hashCode(word)) % colors.length;
            return colors[idx];
        };

        const isSquare = (shape === 'square' || shape === 'rect');
        const cloudShape = isSquare ? 'square' : 'circle';
        const ellipticity = isSquare ? (targetH / targetW) : 0.65;

        return new Promise((resolve) => {
            let finished = false;
            const done = () => {
                if (finished) return;
                finished = true;
                resolve(exportCanvas);
            };

            exportCanvas.addEventListener('wordcloudstop', done, { once: true });
            setTimeout(done, 2200); // タイムアウトフォールバック

            WordCloud(exportCanvas, {
                list: list,
                gridSize: Math.max(8, Math.round(9 * (targetW / 960))),
                weightFactor: 1,
                fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "BIZ UDPGothic", "Hiragino Kaku Gothic ProN", sans-serif',
                color: colorCallback,
                backgroundColor: '#ffffff',
                shape: cloudShape,
                ellipticity: ellipticity,
                rotateRatio: 0,
                rotationSteps: 0,
                minRotation: 0,
                maxRotation: 0,
                shuffle: false,
                drawOutOfBound: false,
                shrinkToFit: true
            });
        });
    },

    hashCode(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return hash;
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = WordCloudVisualizer;
}
