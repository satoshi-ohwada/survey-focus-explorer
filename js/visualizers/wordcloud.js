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

        const maxVal = Math.max(...filtered.map(w => rankingMethod === 'tfidf' ? w.tfidf : w.count));
        const minVal = Math.min(...filtered.map(w => rankingMethod === 'tfidf' ? w.tfidf : w.count));

        // 単語数に応じた適応的フォントサイズ調整（語数が多いときは詰め、少ないときは見栄えよく）
        let wordCountScale = 1.0;
        if (filtered.length > 70) {
            wordCountScale = Math.max(0.65, Math.sqrt(70 / filtered.length));
        } else if (filtered.length < 35) {
            wordCountScale = 1.15;
        }

        // 画面の高さに応じてフォントサイズのスケールを自然に調整（ノートPCから大画面まで美しくフィット）
        const baseMinFont = Math.round((height < 440 ? 12 : (height > 720 ? 16 : 14)) * wordCountScale);
        const baseMaxFont = Math.round((height < 440 ? 44 : (height > 750 ? 80 : (height > 600 ? 66 : 54))) * wordCountScale);
        const fontRange = Math.max(10, baseMaxFont - baseMinFont);

        // wordcloud2.js 形式のリスト: [[text, weight], ...]
        const list = filtered.map(item => {
            const val = rankingMethod === 'tfidf' ? item.tfidf : item.count;
            const scale = maxVal > minVal ? (val - minVal) / (maxVal - minVal) : 0.5;
            const size = baseMinFont + scale * fontRange;
            return [item.text, size, item];
        });

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
                gridSize: Math.round(14 * (width / 960)),
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

        const maxVal = Math.max(...filtered.map(w => this.lastRanking === 'tfidf' ? w.tfidf : w.count));
        const minVal = Math.min(...filtered.map(w => this.lastRanking === 'tfidf' ? w.tfidf : w.count));

        let wordCountScale = 1.0;
        if (filtered.length > 70) {
            wordCountScale = Math.max(0.65, Math.sqrt(70 / filtered.length));
        } else if (filtered.length < 35) {
            wordCountScale = 1.15;
        }

        const baseMin = Math.round(18 * wordCountScale);
        const baseMax = Math.round(86 * wordCountScale);
        const range = Math.max(12, baseMax - baseMin);

        // 1200x900 用にフォントサイズをダイナミックに拡大
        const list = filtered.map(item => {
            const val = this.lastRanking === 'tfidf' ? item.tfidf : item.count;
            const scale = maxVal > minVal ? (val - minVal) / (maxVal - minVal) : 0.5;
            const size = baseMin + scale * range;
            return [item.text, size, item];
        });

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

        const isSquare = (this.lastShape === 'square' || this.lastShape === 'rect');
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
                gridSize: 14,
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
