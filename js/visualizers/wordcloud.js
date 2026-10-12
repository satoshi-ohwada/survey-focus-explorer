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
        const maxWords = options.maxWords || 60;
        const parentW = this.canvas.parentElement ? this.canvas.parentElement.clientWidth : 0;
        const width = parentW > 50 ? parentW : (this.canvas.clientWidth > 50 ? this.canvas.clientWidth : 800);
        const height = 480;

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

        // wordcloud2.js 形式のリスト: [[text, weight], ...]
        const list = filtered.map(item => {
            const val = rankingMethod === 'tfidf' ? item.tfidf : item.count;
            // フォントサイズの重み付け（14px 〜 64px 程度）
            const scale = maxVal > minVal ? (val - minVal) / (maxVal - minVal) : 0.5;
            const size = 16 + scale * 48;
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

        if (typeof WordCloud === 'function') {
            WordCloud(this.canvas, {
                list: list,
                gridSize: Math.round(16 * (width / 1024)),
                weightFactor: 1,
                fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "BIZ UDPGothic", "Hiragino Kaku Gothic ProN", sans-serif',
                color: colorCallback,
                backgroundColor: '#ffffff',
                rotateRatio: 0.15,
                rotationSteps: 2,
                minRotation: -Math.PI / 6,
                maxRotation: Math.PI / 6,
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
