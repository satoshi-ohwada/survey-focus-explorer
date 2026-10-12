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
     * @param {Array<object>} allRows - 全回答
     * @param {Array<object>} matchedDocs - 抽出された関連回答
     * @param {string} attrCol - 属性列名
     * @param {string} targetKeyword - 注目キーワード
     */
    render(allRows, matchedDocs, attrCol, targetKeyword) {
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

        // 1. 全回答における属性ごとの件数集計
        const totalByAttr = {};
        allRows.forEach(r => {
            const val = r[attrCol] != null && String(r[attrCol]).trim() !== '' ? String(r[attrCol]).trim() : '（未回答・不明）';
            totalByAttr[val] = (totalByAttr[val] || 0) + 1;
        });

        // 2. 抽出された意見における属性ごとの件数集計
        const matchedByAttr = {};
        matchedDocs.forEach(d => {
            const val = d.attribute && d.attribute.trim() !== '' ? d.attribute.trim() : '（未回答・不明）';
            matchedByAttr[val] = (matchedByAttr[val] || 0) + 1;
        });

        // 属性カテゴリのリスト
        const attrCategories = Object.keys(totalByAttr);
        if (attrCategories.length === 0) {
            container.innerHTML = `<div style="text-align:center; padding: 40px; color:#64748b;">集計可能な属性データがありません</div>`;
            return;
        }

        // 割合（出現率%）の計算
        const dataRows = attrCategories.map(cat => {
            const tot = totalByAttr[cat] || 0;
            const mat = matchedByAttr[cat] || 0;
            const rate = tot > 0 ? (mat / tot) * 100 : 0;
            return {
                category: cat,
                total: tot,
                matched: mat,
                rate: Math.round(rate * 10) / 10
            };
        });

        // 出現率の降順にソート
        dataRows.sort((a, b) => b.rate - a.rate);

        const yCats = dataRows.map(d => d.category).reverse();
        const xRates = dataRows.map(d => d.rate).reverse();
        const textLabels = dataRows.map(d => `${d.rate}% (${d.matched}件 / 全${d.total}件)`).reverse();

        const trace = {
            type: 'bar',
            orientation: 'h',
            x: xRates,
            y: yCats,
            text: textLabels,
            textposition: 'auto',
            marker: {
                color: '#2563eb',
                opacity: 0.85
            },
            hoverinfo: 'text'
        };

        const layout = {
            title: {
                text: `<b>属性別「${targetKeyword}」関連意見の言及割合 (%)</b>`,
                font: { size: 15, color: '#1e293b' }
            },
            margin: { l: 120, r: 40, t: 50, b: 50 },
            xaxis: {
                title: '言及割合 (%)',
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

        const config = {
            responsive: true,
            displayModeBar: false
        };

        if (typeof Plotly !== 'undefined') {
            Plotly.newPlot(container, [trace], layout, config);
        }
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = AttrChartVisualizer;
}
