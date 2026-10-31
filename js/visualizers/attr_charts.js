/**
 * 属性別クロス集計可視化モジュール
 * Plotly.js を用いて属性グループごとのキーワード関連意見の出現傾向を描画
 */
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

        if (calcMode === 'share') {
            dataRows.sort((a, b) => b.share - a.share);
        } else {
            dataRows.sort((a, b) => b.rate - a.rate);
        }

        const denomLabel = isFiltered ? '対象' : '全';
        const yCats = dataRows.map(d => d.category).reverse();
        const xValues = dataRows.map(d => (calcMode === 'share' ? d.share : d.rate)).reverse();
        const textLabels = dataRows.map(d => {
            if (calcMode === 'share') {
                return `${d.share}% (${d.matched}件 / 意見全体${totalMatched.toLocaleString()}件)`;
            } else {
                return `${d.rate}% (${d.matched}件 / ${denomLabel}${d.total.toLocaleString()}件)`;
            }
        }).reverse();

        const hoverLabels = dataRows.map(d => {
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

        return { trace, layout, dataRows, totalMatched };
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
    async getExportImage(targetRows, matchedDocs, attrCol, targetKeyword, options = {}, targetW = 1200, targetH = 900) {
        if (typeof Plotly === 'undefined') return '';
        const plotData = this.buildPlotData(targetRows, matchedDocs, attrCol, targetKeyword, options);
        if (!plotData) return '';

        const exportLayout = {
            ...plotData.layout,
            width: targetW,
            height: targetH
        };

        try {
            return await Plotly.toImage({
                data: [plotData.trace],
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
}
