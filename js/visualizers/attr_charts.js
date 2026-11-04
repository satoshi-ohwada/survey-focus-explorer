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
        // 1. 変化・改善・悪化 (良くなっている〜悪くなっている)
        {
            name: 'change_better_worse',
            levels: [
                ['大幅に良くなっている', '非常に良くなっている', '大いに良くなっている', 'かなり良くなっている', '大幅に改善', '大きく改善'],
                ['良くなっている', '改善している', 'よくなっている', '向上している'],
                ['やや良くなっている', '少し良くなっている', '多少良くなっている', 'やや改善', '少し改善', 'やや向上'],
                ['変わらない', '変化なし', '変化はない', 'あまり変わらない', '横ばい', '以前と変わらない', '前と変わらない', 'どちらともいえない', 'どちらでもない', '特段の変化なし'],
                ['やや悪くなっている', '少し悪くなっている', '多少悪くなっている', 'やや悪化', '少し悪化', 'やや低下'],
                ['悪くなっている', '悪化している', 'わるくなっている', '低下している'],
                ['大幅に悪くなっている', '大いに悪くなっている', '非常に悪くなっている', 'かなり悪くなっている', '大幅に悪化', '大きく悪化']
            ]
        },
        // 2. 良い・悪い (5段階 / 3段階)
        {
            name: 'good_bad',
            levels: [
                ['大変良い', '非常に良い', 'とても良い', '極めて良い', 'かなり良い', '凄く良い', 'すごく良い'],
                ['良い', 'よい', '良好'],
                ['やや良い', 'まあまあ良い', '少し良い', '比較的良い'],
                ['普通', 'どちらでもない', 'どちらともいえない', 'ふつう', '中立'],
                ['やや悪い', 'あまり良くない', '少し悪い', '比較的悪い'],
                ['悪い', 'わるい', '不良'],
                ['とても悪い', '非常に悪い', '大変悪い', '極めて悪い']
            ]
        },
        // 3. 満足・不満 (5段階 / 3段階)
        {
            name: 'satisfaction',
            levels: [
                ['大変満足', '非常に満足', 'とても満足', '極めて満足', 'かなり満足'],
                ['満足'],
                ['やや満足', 'まあまあ満足', '少し満足', 'おおむね満足'],
                ['どちらともいえない', 'どちらでもない', '普通', 'ふつう'],
                ['やや不満', '少し不満', 'あまり満足していない'],
                ['不満'],
                ['大変不満', '非常に不満', 'とても不満', '極めて不満']
            ]
        },
        // 4. 増減・数量変化
        {
            name: 'change_increase_decrease',
            levels: [
                ['大幅に増えている', '大幅に増加', '大幅に増えた'],
                ['増えている', '増えた', '増加している', '増加した', '多くなっている', '多くなった'],
                ['やや増えている', 'やや増えた', '少し増えた', 'やや増加', '少し増加', 'やや多くなった'],
                ['変わらない', '変化なし', '変化はない', '横ばい', 'あまり変わらない', '以前と変わらない', '前と変わらない'],
                ['やや減っている', 'やや減った', '少し減った', 'やや減少', '少し減少', 'やや少なくなった'],
                ['減っている', '減った', '減少している', '減少した', '少なくなっている', '少なくなった'],
                ['大幅に減っている', '大幅に減少', '大幅に減った']
            ]
        },
        // 5. 利便性・使いやすさ変化
        {
            name: 'change_convenience',
            levels: [
                ['便利になった', '使いやすくなった', 'かなり便利になった'],
                ['やや便利になった', '少し便利になった', '多少使いやすくなった'],
                ['変わらない', '変化なし', '以前と変わらない'],
                ['やや不便になった', '少し不便になった', '使いにくくなった'],
                ['不便になった', 'かなり不便になった']
            ]
        },
        // 6. 賛成・反対 (5段階)
        {
            name: 'agree_disagree',
            levels: [
                ['強く賛成', '大いに賛成'],
                ['賛成'],
                ['やや賛成', '少し賛成'],
                ['どちらでもない', 'どちらともいえない'],
                ['やや反対', '少し反対'],
                ['反対'],
                ['強く反対', '大いに反対']
            ]
        },
        // 7. そう思う・そう思わない
        {
            name: 'think_so',
            levels: [
                ['強くそう思う', '非常にそう思う'],
                ['そう思う'],
                ['ややそう思う', '少しそう思う'],
                ['どちらともいえない', 'どちらでもない'],
                ['あまりそう思わない', 'ややそう思わない', '少しそう思わない'],
                ['そう思わない'],
                ['全くそう思わない', 'ぜんぜんそう思わない']
            ]
        },
        // 8. 同意する・同意しない
        {
            name: 'consent',
            levels: [
                ['強く同意する', '大いに同意する'],
                ['同意する'],
                ['やや同意する', '少し同意する'],
                ['どちらでもない', 'どちらともいえない'],
                ['あまり同意しない', 'やや同意しない'],
                ['同意しない'],
                ['全く同意しない']
            ]
        },
        // 9. 感情・トーン
        {
            name: 'sentiment',
            levels: [
                ['肯定', '肯定的', 'ポジティブ', 'positive'],
                ['中立', 'ニュートラル', '中立的', 'neutral'],
                ['否定', '否定的', 'ネガティブ', 'negative']
            ]
        },
        // 10. 高・中・低
        {
            name: 'high_mid_low',
            levels: [
                ['高', '高い', '高め', '上位'],
                ['中', '普通', '中間', '中位'],
                ['低', '低い', '低め', '下位']
            ]
        },
        // 11. 大・中・小
        {
            name: 'large_mid_small',
            levels: [
                ['大', '大きい'],
                ['中', '普通'],
                ['小', '小さい']
            ]
        },
        // 12. 成績・評定
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
        // 13. Yes / No
        {
            name: 'yes_no',
            levels: [
                ['はい', 'yes', 'true'],
                ['いいえ', 'no', 'false']
            ]
        },
        // 14. 有無
        {
            name: 'presence',
            levels: [
                ['あり', '有', '利用あり', '経験あり'],
                ['なし', '無', '利用なし', '経験なし']
            ]
        },
        // 15. 頻度
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
        // 16. 性別（標準順）
        {
            name: 'gender',
            levels: [
                ['男性', '男', 'male'],
                ['女性', '女', 'female']
            ]
        },
        // 17. 曜日
        {
            name: 'day_of_week',
            levels: [
                ['月曜日', '月曜', '月'],
                ['火曜日', '火曜', '火'],
                ['水曜日', '水曜', '水'],
                ['木曜日', '木曜', '木'],
                ['金曜日', '金曜', '金'],
                ['土曜日', '土曜', '土'],
                ['日曜日', '日曜', '日']
            ]
        },
        // 18. 四半期・期
        {
            name: 'quarter',
            levels: [
                ['第1四半期', '1q', '第1期', '1期'],
                ['第2四半期', '2q', '第2期', '2期'],
                ['第3四半期', '3q', '第3期', '3期'],
                ['第4四半期', '4q', '第4期', '4期']
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

    /**
     * カテゴリ文字列がスケール内のどのレベルに合致するかを判定（完全一致優先、次点で最長部分一致）
     * @param {string} norm - 正規化済みカテゴリ文字列
     * @param {object} scale - スケール定義
     * @returns {number} レベルのインデックス（一致なしの場合は -1）
     */
    findLevelForCategory(norm, scale) {
        if (!norm) return -1;
        const n = norm.toLowerCase();
        // 1. 完全一致（Exact Match）
        for (let i = 0; i < scale.levels.length; i++) {
            for (const syn of scale.levels[i]) {
                if (syn.toLowerCase() === n) return i;
            }
        }
        // 2. 最長部分一致（Longest Partial Match）
        let bestLevel = -1;
        let longestMatchLen = 0;
        for (let i = 0; i < scale.levels.length; i++) {
            for (const syn of scale.levels[i]) {
                const s = syn.toLowerCase();
                if (n.includes(s) || s.includes(n)) {
                    const matchLen = Math.min(n.length, s.length);
                    if (matchLen > longestMatchLen) {
                        longestMatchLen = matchLen;
                        bestLevel = i;
                    }
                }
            }
        }
        return bestLevel;
    },

    /**
     * 和暦（元号＋年、年月、期など）を解析し、時系列比較用の絶対西暦数値ランクを算出
     * @param {string} norm - 正規化済みカテゴリ文字列
     * @returns {number|null} 西暦換算ランク（例: 令和元年=2019, 令和2年4月=2020.04）、判定不能時はnull
     */
    extractWarekiRank(norm) {
        if (!norm) return null;

        // 全角英数・記号の半角化
        let s = String(norm).trim()
            .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
            .replace(/[Ａ-Ｚａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
            .replace(/[\uFF0F]/g, '/')
            .replace(/[\uFF0E]/g, '.')
            .replace(/[\uFF0D\u2212\u2014\u2015ー]/g, '-')
            .trim();

        const eras = [
            { name: '令和', aliases: ['令和', '令', 'r'], offset: 2018, start: 2019 },
            { name: '平成', aliases: ['平成', '平', 'h'], offset: 1988, start: 1989 },
            { name: '昭和', aliases: ['昭和', '昭', 's'], offset: 1925, start: 1926 },
            { name: '大正', aliases: ['大正', 't'], offset: 1911, start: 1912 },
            { name: '明治', aliases: ['明治', 'm'], offset: 1867, start: 1868 }
        ];

        // 1. 元号単体（例: 「昭和」「平成」「令和」）
        for (const era of eras) {
            if (s === era.name) {
                return era.start;
            }
        }

        // 漢数字を数字に変換（「元年」の「元」は個別処理するためそのまま残す）
        const kanjiDigits = { '〇': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
        s = s.replace(/([一二三四五六七八九〇十]+)/g, (match) => {
            if (match === '十') return '10';
            if (match.startsWith('十')) return String(10 + (kanjiDigits[match[1]] || 0));
            if (match.includes('十')) {
                const parts = match.split('十');
                const ten = kanjiDigits[parts[0]] != null ? kanjiDigits[parts[0]] : 1;
                const unit = parts[1] ? (kanjiDigits[parts[1]] || 0) : 0;
                return String(ten * 10 + unit);
            }
            return match.split('').map(c => kanjiDigits[c] != null ? kanjiDigits[c] : c).join('');
        });

        // 2. 元号 + 年（例: 令和5年, 令和元年, 令和5年度, R5, R05, H30, 令5, 平30, 昭和30年代）
        const eraRegex = /^(令和|平成|昭和|大正|明治|令|平|昭|[RrHhSsTtMm])\s*[.\-_/]?\s*(元|\d{1,2})\s*(年代|年度|年)?/i;
        const match = s.match(eraRegex);
        if (!match) return null;

        const eraPrefix = match[1].toLowerCase();
        const yearPart = match[2];
        const unitPart = match[3] || '';
        const matchedEra = eras.find(e => e.aliases.some(a => a.toLowerCase() === eraPrefix));
        if (!matchedEra) return null;

        const warekiYear = yearPart === '元' ? 1 : parseInt(yearPart, 10);
        if (isNaN(warekiYear)) return null;

        let calYear = matchedEra.offset + warekiYear;
        if (unitPart === '年代') {
            return calYear;
        }

        // 年以降の文字列から月・四半期・期・日を抽出
        const rest = s.slice(match[0].length).trim();
        let month = 0;
        let day = 0;

        if (rest) {
            const qMatch = rest.match(/^(?:第?([1-4])\s*(?:四半期|期|Q)|([1-4])Q)/i);
            if (qMatch) {
                const q = parseInt(qMatch[1] || qMatch[2], 10);
                month = q * 3;
            } else {
                const monthMatch = rest.match(/^(?:[.\-/_]\s*(\d{1,2})|(\d{1,2})\s*月)/);
                if (monthMatch) {
                    month = parseInt(monthMatch[1] || monthMatch[2], 10);
                    const afterMonth = rest.slice(monthMatch[0].length).trim();
                    const dayMatch = afterMonth.match(/^(?:[.\-/_]\s*(\d{1,2})|(\d{1,2})\s*日)/);
                    if (dayMatch) {
                        day = parseInt(dayMatch[1] || dayMatch[2], 10);
                    }
                }
            }
        }

        let rank = calYear;
        if (month >= 1 && month <= 12) {
            rank += month / 100;
            if (day >= 1 && day <= 31) {
                rank += day / 10000;
            }
        }

        if (s.includes('未満') || s.includes('以下') || s.includes('以前') || s.includes('前')) {
            rank -= 0.00005;
        } else if (s.includes('以上') || s.includes('以降') || s.includes('超') || s.includes('後')) {
            rank += 0.00005;
        }

        return rank;
    },

    /**
     * 西暦（年、年月、期など）を解析し、時系列比較用の絶対数値ランクを算出
     * @param {string} norm - 正規化済みカテゴリ文字列
     * @returns {number|null} 西暦換算ランク（例: 2024年4月=2024.04）、判定不能時はnull
     */
    extractWesternDateRank(norm) {
        if (!norm) return null;
        let s = String(norm).trim()
            .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
            .replace(/[Ａ-Ｚａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
            .replace(/[\uFF0F]/g, '/')
            .replace(/[\uFF0E]/g, '.')
            .replace(/[\uFF0D\u2212\u2014\u2015ー]/g, '-')
            .trim();

        // 4桁の西暦（1800〜2199）
        const yearMatch = s.match(/^(18\d{2}|19\d{2}|20\d{2}|21\d{2})\s*(年代|年度|年)?/);
        if (!yearMatch) return null;

        const calYear = parseInt(yearMatch[1], 10);
        const unitPart = yearMatch[2] || '';
        if (unitPart === '年代') {
            return calYear;
        }

        const rest = s.slice(yearMatch[0].length).trim();
        let month = 0;
        let day = 0;

        if (rest) {
            const qMatch = rest.match(/^(?:第?([1-4])\s*(?:四半期|期|Q)|([1-4])Q)/i);
            if (qMatch) {
                const q = parseInt(qMatch[1] || qMatch[2], 10);
                month = q * 3;
            } else {
                const monthMatch = rest.match(/^(?:[.\-/_]\s*(\d{1,2})|(\d{1,2})\s*月)/);
                if (monthMatch) {
                    month = parseInt(monthMatch[1] || monthMatch[2], 10);
                    const afterMonth = rest.slice(monthMatch[0].length).trim();
                    const dayMatch = afterMonth.match(/^(?:[.\-/_]\s*(\d{1,2})|(\d{1,2})\s*日)/);
                    if (dayMatch) {
                        day = parseInt(dayMatch[1] || dayMatch[2], 10);
                    }
                }
            }
        }

        let rank = calYear;
        if (month >= 1 && month <= 12) {
            rank += month / 100;
            if (day >= 1 && day <= 31) {
                rank += day / 10000;
            }
        }

        if (s.includes('未満') || s.includes('以下') || s.includes('以前') || s.includes('前')) {
            rank -= 0.00005;
        } else if (s.includes('以上') || s.includes('以降') || s.includes('超') || s.includes('後')) {
            rank += 0.00005;
        }

        return rank;
    },

    extractNumericRank(category) {
        if (!category) return null;
        const norm = this.normalizeCategory(category);

        // 1. 和暦判定（令和・平成・昭和・大正・明治）
        const warekiRank = this.extractWarekiRank(norm);
        if (warekiRank !== null) return warekiRank;

        // 2. 西暦判定（1800〜2199年、年月・四半期・期・日含む）
        const westernRank = this.extractWesternDateRank(norm);
        if (westernRank !== null) return westernRank;

        // 3. 年代・年齢（20代、30歳など）
        const ageMatch = norm.match(/(\d+)\s*(代|歳)/);
        if (ageMatch) {
            let val = parseFloat(ageMatch[1]);
            if (norm.includes('未満') || norm.includes('以下')) val -= 0.5;
            else if (norm.includes('以上')) val += 0.5;
            return val;
        }

        // 4. 数値範囲（〜、-）
        const rangeMatch = norm.match(/(\d+)\s*[〜~\-ー]/);
        if (rangeMatch) {
            return parseFloat(rangeMatch[1]);
        }

        // 5. 先頭の純粋な数値
        const pureNum = norm.match(/^(\d+(?:\.\d+)?)/);
        if (pureNum) {
            let v = parseFloat(pureNum[1]);
            if (norm.includes('未満') || norm.includes('以下')) v -= 0.5;
            if (norm.includes('以上') || norm.includes('超')) v += 0.5;
            return v;
        }

        // 6. 丸数字（①〜⑳）
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
                const lvl = this.findLevelForCategory(norm, scale);
                if (lvl >= 0) {
                    matches++;
                    seenLevels.add(lvl);
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

        // 1. スケール順序（評価・満足度・賛否・変化など）
        const scale = this.detectScale(validItems);
        if (scale) {
            const getRank = (item) => {
                const norm = this.normalizeCategory(item.category != null ? item.category : item);
                const lvl = this.findLevelForCategory(norm, scale);
                return lvl >= 0 ? lvl : 999;
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
            ? ` <span style="font-size: 0.8em; font-weight: normal; color: #64748b;">(分析対象 ${targetRows.length.toLocaleString()}件 基準)</span>`
            : '';

        const axisTitle = calcMode === 'share' ? '意見全体の構成比 (%)' : '属性内の言及割合 (%)';

        const layout = {
            title: {
                text: `<b>${modeTitle}</b>${titleSub}`,
                font: { size: 15, color: '#1e293b' }
            },
            margin: { l: 120, r: 40, t: 50, b: 50 },
            xaxis: {
                title: {
                    text: axisTitle,
                    font: { size: 13, color: '#475569' }
                },
                tickfont: { size: 12, color: '#475569' },
                ticksuffix: '%',
                rangemode: 'tozero',
                gridcolor: '#f1f5f9'
            },
            yaxis: {
                tickfont: { size: 13, color: '#1e293b' },
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
     * エクスポート・保存・印刷用高解像度画像の取得（画面表示と同一の文字サイズ感を忠実に再現）
     * @param {Array<object>} targetRows
     * @param {Array<object>} matchedDocs
     * @param {string} attrCol
     * @param {string} targetKeyword
     * @param {object} options
     * @param {number} targetW 出力キャンバス幅 (保存: 1200, 印刷: 1600)
     * @param {number} targetH 出力キャンバス高さ (保存: 900, 印刷: 1200)
     * @returns {Promise<string>} Base64 PNG Data URL
     */
    async getExportImage(targetRows, matchedDocs, attrCol, targetKeyword, options = {}, targetW = 1200, targetH = 900) {
        if (typeof Plotly === 'undefined') return '';
        const plotData = this.buildPlotData(targetRows, matchedDocs, attrCol, targetKeyword, options);
        if (!plotData) return '';

        // 基準画面寸法 (680x510) からのスケール倍率を算出
        // 出力解像度（1200x900 や 1600x1200）に比例して文字サイズと余白を拡大し、画面表示と完全に同じサイズ感を維持
        const scale = Math.min(targetW / 680, targetH / 510);

        const titleFontSize = Math.max(18, Math.round(16 * scale));
        const yTickFontSize = Math.max(14, Math.round(13.5 * scale));
        const barFontSize = Math.max(13, Math.round(12.5 * scale));
        const xTitleFontSize = Math.max(14, Math.round(14 * scale));
        const xTickFontSize = Math.max(12, Math.round(12 * scale));

        const marginL = Math.max(Math.round(140 * scale), 120);
        const marginR = Math.max(Math.round(50 * scale), 40);
        const marginT = Math.max(Math.round(55 * scale), 50);
        const marginB = Math.max(Math.round(60 * scale), 50);

        const fontFam = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "BIZ UDPGothic", "Hiragino Kaku Gothic ProN", sans-serif';

        // バー内・外テキストともに画面同様のサイズでくっきり描画
        const exportTrace = {
            ...plotData.trace,
            textposition: 'auto',
            insidetextfont: {
                family: fontFam,
                size: barFontSize,
                color: '#ffffff'
            },
            outsidetextfont: {
                family: fontFam,
                size: barFontSize,
                color: '#1e293b'
            }
        };

        const titleText = (plotData.layout.title && plotData.layout.title.text) ? plotData.layout.title.text : '';
        const axisTitleText = (plotData.layout.xaxis && (typeof plotData.layout.xaxis.title === 'string' ? plotData.layout.xaxis.title : (plotData.layout.xaxis.title && plotData.layout.xaxis.title.text))) || '';

        const exportLayout = {
            ...plotData.layout,
            width: targetW,
            height: targetH,
            font: {
                family: fontFam,
                size: yTickFontSize,
                color: '#1e293b'
            },
            title: {
                text: titleText,
                font: {
                    family: fontFam,
                    size: titleFontSize,
                    color: '#0f172a'
                }
            },
            margin: { l: marginL, r: marginR, t: marginT, b: marginB },
            xaxis: {
                ...plotData.layout.xaxis,
                title: {
                    text: axisTitleText,
                    font: { family: fontFam, size: xTitleFontSize, color: '#475569' }
                },
                tickfont: { family: fontFam, size: xTickFontSize, color: '#475569' }
            },
            yaxis: {
                ...plotData.layout.yaxis,
                tickfont: { family: fontFam, size: yTickFontSize, color: '#0f172a' },
                automargin: true
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
