/**
 * 属性別クロス集計可視化モジュール
 * Plotly.js を用いて属性グループごとのキーワード関連意見の出現傾向を描画
 */

/**
 * 属性カテゴリの自動判定 ＆ 自然順序ソートユーティリティ
 * - 評価・満足度・賛否等の順序尺度: 自然な評価順（良い→普通→悪い、満足→不満 等）
 * - 年代・数値範囲: 数値昇順（10代未満→20代→...→60代以上）
 * - それ以外（部署・地域等の名義尺度）: 言及割合が多い順（降順）
 * - 「その他」「未回答」「不明」: 常に末尾固定
 */
const AttributeSorter = {
    ORDINAL_SCALES: [
        // 1. 良い・悪い (5段階 / 3段階)
        {
            name: 'good_bad',
            levels: [
                ['大変良い', '非常に良い', 'とても良い', '極めて良い', 'かなり良い', '凄く良い', 'すごく良い'],
                ['良い', 'よい', '良好', 'やや良い', 'まあまあ良い', '比較的良い'],
                ['普通', 'どちらでもない', 'どちらともいえない', 'ふつう', '中立'],
                ['やや悪い', 'あまり良くない', '少し悪い', '比較的悪い'],
                ['悪い', 'わるい', '不良', 'とても悪い', '非常に悪い', '大変悪い', '極めて悪い']
            ]
        },
        // 2. 満足・不満 (5段階 / 3段階)
        {
            name: 'satisfaction',
            levels: [
                ['大変満足', '非常に満足', 'とても満足', '極めて満足', 'かなり満足'],
                ['満足', 'やや満足', 'まあまあ満足', 'おおむね満足'],
                ['どちらともいえない', 'どちらでもない', '普通', 'ふつう'],
                ['やや不満', '少し不満'],
                ['不満', '大変不満', '非常に不満', 'とても不満', '極めて不満']
            ]
        },
        // 3. 賛成・反対 (5段階)
        {
            name: 'agree_disagree',
            levels: [
                ['強く賛成', '大いに賛成'],
                ['賛成', 'やや賛成'],
                ['どちらでもない', 'どちらともいえない'],
                ['やや反対', '少し反対'],
                ['反対', '強く反対', '大いに反対']
            ]
        },
        // 4. そう思う・そう思わない
        {
            name: 'think_so',
            levels: [
                ['強くそう思う', '非常にそう思う'],
                ['そう思う', 'ややそう思う'],
                ['どちらともいえない', 'どちらでもない'],
                ['あまりそう思わない', 'ややそう思わない'],
                ['そう思わない', '全くそう思わない', 'ぜんぜんそう思わない']
            ]
        },
        // 5. 同意する・同意しない
        {
            name: 'consent',
            levels: [
                ['強く同意する', '大いに同意する'],
                ['同意する', 'やや同意する'],
                ['どちらでもない', 'どちらともいえない'],
                ['あまり同意しない', 'やや同意しない'],
                ['同意しない', '全く同意しない']
            ]
        },
        // 6. 感情・トーン
        {
            name: 'sentiment',
            levels: [
                ['肯定', '肯定的', 'ポジティブ', 'positive'],
                ['中立', 'ニュートラル', '中立的', 'neutral'],
                ['否定', '否定的', 'ネガティブ', 'negative']
            ]
        },
        // 7. 高・中・低
        {
            name: 'high_mid_low',
            levels: [
                ['高', '高い', '高め', '上位'],
                ['中', '普通', '中間', '中位'],
                ['低', '低い', '低め', '下位']
            ]
        },
        // 8. 大・中・小
        {
            name: 'large_mid_small',
            levels: [
                ['大', '大きい'],
                ['中', '普通'],
                ['小', '小さい']
            ]
        },
        // 9. 成績・評定
        {
            name: 'academic_grades',
            levels: [
                ['秀'],
                ['優', 'A', 'a'],
                ['良', 'B', 'b'],
                ['可', 'C', 'c'],
                ['不可', 'D', 'd', 'F', 'f']
            ]
        },
        // 10. Yes / No
        {
            name: 'yes_no',
            levels: [
                ['はい', 'yes', 'true'],
                ['いいえ', 'no', 'false']
            ]
        },
        // 11. 有無
        {
            name: 'presence',
            levels: [
                ['あり', '有', '利用あり', '経験あり'],
                ['なし', '無', '利用なし', '経験なし']
            ]
        },
        // 12. 頻度
        {
            name: 'frequency',
            levels: [
                ['毎日', 'デイリー'],
                ['週に数回', '週2-3回', '週1回以上', '週1日以上'],
                ['月に数回', '月2-3回', '月1回以上'],
                ['数か月に1回', '年に数回'],
                ['ほとんど利用しない', '利用しない', '使わない', '未利用']
            ]
        },
        // 13. 性別（標準順）
        {
            name: 'gender',
            levels: [
                ['男性', '男', 'male'],
                ['女性', '女', 'female']
            ]
        }
    ],

    normalizeCategory(str) {
        if (!str) return '';
        return String(str)
            .trim()
            .replace(/^[\(\[\{【「『]/, '')
            .replace(/[\)\]\}】」』]$/, '')
            .replace(/^[0-9０-９]+[\.\:\s、]/, '')
            .trim();
    },

    isTailCategory(cat) {
        if (!cat) return true;
        const s = String(cat).trim().toLowerCase();
        const tailKeywords = [
            '（未回答・不明）', '未回答', '不明', '無回答', '回答しない', '答えたくない',
            'その他', 'そのほか', '該当なし', 'na', 'n/a', 'none', 'null', 'undefined'
        ];
        return tailKeywords.some(k => s === k || s === `（${k}）` || s === `(${k})`);
    },

    extractNumericRank(category) {
        if (!category) return null;
        const norm = this.normalizeCategory(category);
        const ageMatch = norm.match(/(\d+)\s*(代|歳)/);
        if (ageMatch) {
            let val = parseFloat(ageMatch[1]);
            if (norm.includes('未満') || norm.includes('以下')) val -= 0.5;
            else if (norm.includes('以上')) val += 0.5;
            return val;
        }
        const rangeMatch = norm.match(/(\d+)\s*[〜~\-ー]/);
        if (rangeMatch) {
            return parseFloat(rangeMatch[1]);
        }
        const pureNum = norm.match(/^(\d+)/);
        if (pureNum) {
            let v = parseFloat(pureNum[1]);
            if (norm.includes('未満') || norm.includes('以下')) v -= 0.5;
            if (norm.includes('以上') || norm.includes('超')) v += 0.5;
            return v;
        }
        const circled = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
        const cIdx = circled.indexOf(norm.charAt(0));
        if (cIdx >= 0) return cIdx + 1;
        return null;
    },

    detectScale(validItems) {
        let bestScale = null;
        let bestMatches = 0;
        for (const scale of this.ORDINAL_SCALES) {
            let matches = 0;
            const seenLevels = new Set();
            validItems.forEach(item => {
                const norm = this.normalizeCategory(item.category != null ? item.category : item);
                for (let i = 0; i < scale.levels.length; i++) {
                    if (scale.levels[i].some(syn => syn.toLowerCase() === norm.toLowerCase() || norm.toLowerCase().includes(syn.toLowerCase()))) {
                        matches++;
                        seenLevels.add(i);
                        break;
                    }
                }
            });
            // 2つ以上の異なるレベルにマッチしていること（単一レベルのみの一致は誤検知防止）
            if (seenLevels.size >= 2 && matches > bestMatches) {
                bestMatches = matches;
                bestScale = scale;
            }
        }
        if (bestScale && (bestMatches / validItems.length) >= 0.6) {
            return bestScale;
        }
        return null;
    },

    detectNumericOrder(validItems) {
        let numMatches = 0;
        const uniqueValues = new Set();
        validItems.forEach(item => {
            const cat = item.category != null ? item.category : item;
            const rank = this.extractNumericRank(cat);
            if (rank !== null) {
                numMatches++;
                uniqueValues.add(rank);
            }
        });
        if (uniqueValues.size >= 2 && (numMatches / validItems.length) >= 0.6) {
            return true;
        }
        return false;
    },

    /**
     * 属性アイテム配列を自動判定して最適な順序（自然順または多い順）にソート
     * @param {Array<object|string>} items - カテゴリを含む配列
     * @param {string} [calcMode='rate'] - 'rate' | 'share'
     * @returns {Array<object|string>} ソート後の配列
     */
    sort(items, calcMode = 'rate') {
        if (!items || items.length === 0) return [];
        const validItems = [];
        const tailItems = [];
        items.forEach(item => {
            const cat = item.category != null ? item.category : item;
            if (this.isTailCategory(cat)) {
                tailItems.push(item);
            } else {
                validItems.push(item);
            }
        });
        if (validItems.length <= 1) return items.slice();

        // 1. スケール順序（評価・満足度・賛否など）
        const scale = this.detectScale(validItems);
        if (scale) {
            const getRank = (item) => {
                const norm = this.normalizeCategory(item.category != null ? item.category : item);
                for (let i = 0; i < scale.levels.length; i++) {
                    if (scale.levels[i].some(syn => syn.toLowerCase() === norm.toLowerCase() || norm.toLowerCase().includes(syn.toLowerCase()))) {
                        return i;
                    }
                }
                return 999;
            };
            validItems.sort((a, b) => getRank(a) - getRank(b));
            return validItems.concat(tailItems);
        }

        // 2. 年代・数値順序
        if (this.detectNumericOrder(validItems)) {
            validItems.sort((a, b) => {
                const catA = a.category != null ? a.category : a;
                const catB = b.category != null ? b.category : b;
                const rA = this.extractNumericRank(catA);
                const rB = this.extractNumericRank(catB);
                if (rA !== null && rB !== null && rA !== rB) return rA - rB;
                if (rA !== null && rB === null) return -1;
                if (rA === null && rB !== null) return 1;
                return String(catA).localeCompare(String(catB), undefined, { numeric: true, sensitivity: 'base' });
            });
            return validItems.concat(tailItems);
        }

        // 3. 名義尺度: 言及割合が多い順（降順）
        validItems.sort((a, b) => {
            const valA = parseFloat(calcMode === 'share' ? (a.share != null ? a.share : a.rate) : (a.rate != null ? a.rate : a.share)) || 0;
            const valB = parseFloat(calcMode === 'share' ? (b.share != null ? b.share : b.rate) : (b.rate != null ? b.rate : b.share)) || 0;
            if (valB !== valA) return valB - valA;
            const cntA = a.matchedCount != null ? a.matchedCount : (a.matched || 0);
            const cntB = b.matchedCount != null ? b.matchedCount : (b.matched || 0);
            return cntB - cntA;
        });

        return validItems.concat(tailItems);
    }
};

if (typeof window !== 'undefined') {
    window.AttributeSorter = AttributeSorter;
}

const AttrChartVisualizer = {
    containerId: null,

    init(containerId) {
        this.containerId = containerId;
    },

    /**
     * 属性別クロス集計を描画
     * @param {Array<object>} targetRows - 分析対象回答（絞り込み・ノイズ除外後）
     * @param {Array<object>} matchedDocs - 抽出された関連回答
     * @param {string} attrCol - 属性列名
     * @param {string} targetKeyword - 注目キーワード
     * @param {object} [options]
     * @param {boolean} [options.isFiltered=false] 絞り込みが行われているか
     * @param {number} [options.totalRawCount] 元データ全件数
     */
    /**
     * 属性集計とPlotly用トレース・レイアウトを生成
     */
    buildPlotData(targetRows, matchedDocs, attrCol, targetKeyword, options = {}) {
        if (!attrCol || !targetRows || targetRows.length === 0) return null;

        const isFiltered = options.isFiltered || false;
        const calcMode = options.calcMode || 'rate'; // 'rate' | 'share'

        // 1. 分析対象（絞り込み後）における属性ごとの件数集計
        const totalByAttr = {};
        targetRows.forEach(r => {
            const val = r[attrCol] != null && String(r[attrCol]).trim() !== '' ? String(r[attrCol]).trim() : '（未回答・不明）';
            totalByAttr[val] = (totalByAttr[val] || 0) + 1;
        });

        // 2. 抽出された意見における属性ごとの件数集計
        const matchedByAttr = {};
        let totalMatched = 0;
        (matchedDocs || []).forEach(d => {
            const val = d.attribute && d.attribute.trim() !== '' ? d.attribute.trim() : '（未回答・不明）';
            matchedByAttr[val] = (matchedByAttr[val] || 0) + 1;
            totalMatched++;
        });

        // 属性カテゴリのリスト
        const attrCategories = Object.keys(totalByAttr);
        if (attrCategories.length === 0) return null;

        // 数値の計算（言及率 rate % ＆ 構成比 share %）
        const dataRows = attrCategories.map(cat => {
            const tot = totalByAttr[cat] || 0;
            const mat = matchedByAttr[cat] || 0;
            const rate = tot > 0 ? (mat / tot) * 100 : 0;
            const share = totalMatched > 0 ? (mat / totalMatched) * 100 : 0;
            return {
                category: cat,
                total: tot,
                matched: mat,
                rate: Math.round(rate * 10) / 10,
                share: Math.round(share * 10) / 10
            };
        });

        // 属性の自然順序（年代順・評価順等）または言及割合順（名義尺度）に自動ソート
        const sortedDataRows = AttributeSorter.sort(dataRows, calcMode);

        const denomLabel = isFiltered ? '対象' : '全';
        const yCats = sortedDataRows.map(d => d.category).reverse();
        const xValues = sortedDataRows.map(d => (calcMode === 'share' ? d.share : d.rate)).reverse();
        const textLabels = sortedDataRows.map(d => {
            if (calcMode === 'share') {
                return `${d.share}% (${d.matched}件 / 意見全体${totalMatched.toLocaleString()}件)`;
            } else {
                return `${d.rate}% (${d.matched}件 / ${denomLabel}${d.total.toLocaleString()}件)`;
            }
        }).reverse();

        const hoverLabels = sortedDataRows.map(d => {
            const main = calcMode === 'share'
                ? `<b>【${d.category}】</b><br>構成比: <b>${d.share}%</b> (${d.matched}件 / 意見全体${totalMatched.toLocaleString()}件)`
                : `<b>【${d.category}】</b><br>言及率: <b>${d.rate}%</b> (${d.matched}件 / ${denomLabel}${d.total.toLocaleString()}件)`;
            return `${main}<br><span style="font-size:11px;color:#93c5fd;">👆 クリックで概要 ＆ 代表意見を表示</span>`;
        }).reverse();

        const barColor = calcMode === 'share' ? '#0284c7' : '#2563eb';

        const trace = {
            type: 'bar',
            orientation: 'h',
            x: xValues,
            y: yCats,
            text: textLabels,
            hovertext: hoverLabels,
            textposition: 'auto',
            marker: {
                color: barColor,
                opacity: 0.85
            },
            hoverinfo: 'text'
        };

        const modeTitle = calcMode === 'share'
            ? `属性別「${targetKeyword || '全体'}」関連意見の構成比 (内訳 %)`
            : `属性別「${targetKeyword || '全体'}」関連意見の言及割合 (%)`;

        const titleSub = isFiltered
            ? ` <span style="font-size: 12px; font-weight: normal; color: #64748b;">(分析対象 ${targetRows.length.toLocaleString()}件 基準)</span>`
            : '';

        const axisTitle = calcMode === 'share' ? '意見全体の構成比 (%)' : '属性内の言及割合 (%)';

        const layout = {
            title: {
                text: `<b>${modeTitle}</b>${titleSub}`,
                font: { size: 15, color: '#1e293b' }
            },
            margin: { l: 120, r: 40, t: 50, b: 50 },
            xaxis: {
                title: axisTitle,
                ticksuffix: '%',
                rangemode: 'tozero',
                gridcolor: '#f1f5f9'
            },
            yaxis: {
                automargin: true
            },
            autosize: true,
            plot_bgcolor: '#ffffff',
            paper_bgcolor: '#ffffff'
        };

        return { trace, layout, dataRows: sortedDataRows, totalMatched };
    },

    /**
     * 属性アイテムを自動順序（自然順または割合順）でソートするヘルパー
     */
    sortAttributeData(items, calcMode = 'rate') {
        return AttributeSorter.sort(items, calcMode);
    },

    /**
     * 属性別クロス集計を描画
     */
    render(targetRows, matchedDocs, attrCol, targetKeyword, options = {}) {
        const container = document.getElementById(this.containerId);
        if (!container) return;

        if (!attrCol) {
            container.innerHTML = `
                <div style="text-align: center; padding: 60px 20px; color: #64748b;">
                    <p style="font-size: 16px; margin-bottom: 8px;">📊 属性列が選択されていません</p>
                    <p style="font-size: 13px;">設定パネルで「属性の列（年代・性別など）」を選択すると、属性別のクロス集計グラフが表示されます。</p>
                </div>
            `;
            return;
        }

        const plotData = this.buildPlotData(targetRows, matchedDocs, attrCol, targetKeyword, options);
        if (!plotData) {
            container.innerHTML = `<div style="text-align:center; padding: 40px; color:#64748b;">集計可能な属性データがありません</div>`;
            return;
        }

        const config = {
            responsive: true,
            displayModeBar: false
        };

        if (typeof Plotly !== 'undefined') {
            Plotly.newPlot(container, [plotData.trace], plotData.layout, config).then(() => {
                // クリックイベントの登録（二重登録を防ぐためリスナーを整理）
                if (typeof options.onCategoryClick === 'function') {
                    if (container.removeAllListeners) {
                        container.removeAllListeners('plotly_click');
                    }
                    container.on('plotly_click', (data) => {
                        if (!data || !data.points || data.points.length === 0) return;
                        const pt = data.points[0];
                        const category = pt.y; // 横棒グラフのため y がカテゴリ名
                        if (category) {
                            options.onCategoryClick(category);
                        }
                    });
                }
            });
        }
    },

    /**
     * エクスポート用高解像度画像の取得（DOM表示状態に依存しない）
     */
    async getExportImage(targetRows, matchedDocs, attrCol, targetKeyword, options = {}, targetW = 1000, targetH = 480) {
        if (typeof Plotly === 'undefined') return '';
        const plotData = this.buildPlotData(targetRows, matchedDocs, attrCol, targetKeyword, options);
        if (!plotData) return '';

        // レポート・印刷用に文字を大きく鮮明にしたエクスポート用トレース＆レイアウト
        const exportTrace = {
            ...plotData.trace,
            textfont: {
                size: 20,
                color: '#ffffff',
                family: '"Noto Sans JP", sans-serif'
            }
        };

        const exportLayout = {
            ...plotData.layout,
            width: targetW,
            height: targetH,
            font: {
                family: '"Noto Sans JP", sans-serif',
                size: 19,
                color: '#1e293b'
            },
            title: {
                text: (plotData.layout.title && plotData.layout.title.text) ? plotData.layout.title.text : '',
                font: { size: 21, color: '#0f172a' }
            },
            margin: { l: 140, r: 40, t: 45, b: 55 },
            xaxis: {
                ...plotData.layout.xaxis,
                title: {
                    text: (plotData.layout.xaxis && plotData.layout.xaxis.title) ? plotData.layout.xaxis.title : '',
                    font: { size: 19, color: '#475569' }
                },
                tickfont: { size: 18, color: '#334155' }
            },
            yaxis: {
                ...plotData.layout.yaxis,
                tickfont: { size: 21, color: '#0f172a' }
            }
        };

        try {
            return await Plotly.toImage({
                data: [exportTrace],
                layout: exportLayout
            }, {
                format: 'png',
                width: targetW,
                height: targetH
            });
        } catch (err) {
            console.warn('Plotly.toImage error:', err);
            return '';
        }
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = AttrChartVisualizer;
    module.exports.AttributeSorter = AttributeSorter;
}
