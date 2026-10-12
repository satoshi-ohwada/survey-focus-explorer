/**
 * キーワード関連語探索 ＆ 意見抽出エンジン
 * 指定キーワードに対する共起・文脈関連語の自動算出、
 * および関連語を含む意見（回答文）の抽出・フィルタリングを行う
 */
const AssociationEngine = {
    /**
     * 指定キーワードに対する関連性の高い単語（共起語・文脈語）を探索・算出する
     * @param {Array<Array<string>>} tokensPerDoc - 各文書（回答）の形態素トークン配列
     * @param {Array<object>} rawRows - 元のアンケート行データ
     * @param {string} textCol - 自由記述列名
     * @param {string} targetKeyword - ユーザー指定キーワード
     * @param {object} options - オプション設定
     * @returns {object} { targetKeyword, matchedTargetDocCount, relatedWords, allDocCount }
     */
    findRelatedWords(tokensPerDoc, rawRows, textCol, targetKeyword, options = {}) {
        const cleanKeyword = (targetKeyword || '').trim();
        if (!cleanKeyword) {
            return {
                targetKeyword: '',
                matchedTargetDocCount: 0,
                relatedWords: [],
                allDocCount: rawRows.length,
                error: 'キーワードが指定されていません'
            };
        }

        const topN = options.topN || 12; // デフォルト12語（混乱を避けるため多すぎない数）
        const minCooc = options.minCooc || 2; // 最低共起回数

        const N = rawRows.length;
        // 1. 各単語が出現する文書インデックス集合(Set)と出現回数を構築
        const wordDocMap = new Map(); // word -> Set of docIndex
        const wordFreq = new Map();   // word -> total count

        for (let i = 0; i < N; i++) {
            const tokens = tokensPerDoc[i] || [];
            const seenInThisDoc = new Set();
            for (const t of tokens) {
                wordFreq.set(t, (wordFreq.get(t) || 0) + 1);
                if (!seenInThisDoc.has(t)) {
                    seenInThisDoc.add(t);
                    if (!wordDocMap.has(t)) {
                        wordDocMap.set(t, new Set());
                    }
                    wordDocMap.get(t).add(i);
                }
            }
        }

        // 2. ターゲットキーワードを含む文書のインデックス集合を特定
        let targetDocSet = wordDocMap.get(cleanKeyword) || new Set();

        // もし形態素トークンに完全一致しない場合（複合語や表記揺れなど）、原文テキストで部分一致検索
        if (targetDocSet.size === 0) {
            targetDocSet = new Set();
            const lowerKeyword = cleanKeyword.toLowerCase();
            for (let i = 0; i < N; i++) {
                const text = String(rawRows[i][textCol] || '').toLowerCase();
                if (text.includes(lowerKeyword)) {
                    targetDocSet.add(i);
                }
            }
        }

        const targetDocCount = targetDocSet.size;
        if (targetDocCount === 0) {
            return {
                targetKeyword: cleanKeyword,
                matchedTargetDocCount: 0,
                relatedWords: [],
                allDocCount: N,
                warning: `キーワード「${cleanKeyword}」を含む回答が見つかりませんでした。`
            };
        }

        // 3. 他の各単語との共起度（Jaccard係数 ＆ 自己相互情報量PMI）を計算
        const candidates = [];
        const targetDocArray = Array.from(targetDocSet);

        for (const [w, docSet] of wordDocMap.entries()) {
            if (w === cleanKeyword) continue; // 自単語は除外
            if (w.length <= 1 && !/^[A-Za-z0-9]+$/.test(w)) continue; // 1文字の非英数はスキップ

            // 共起文書数の計算
            let coocCount = 0;
            // 小さい方の集合を走査して高速化
            if (targetDocSet.size < docSet.size) {
                for (let k = 0; k < targetDocArray.length; k++) {
                    if (docSet.has(targetDocArray[k])) coocCount++;
                }
            } else {
                for (const idx of docSet) {
                    if (targetDocSet.has(idx)) coocCount++;
                }
            }

            if (coocCount < minCooc) continue;

            const docCount = docSet.size;
            // Jaccard係数 = |A ∩ B| / |A ∪ B|
            const unionCount = targetDocCount + docCount - coocCount;
            const jaccard = unionCount > 0 ? coocCount / unionCount : 0;

            // Dice係数 = 2 * |A ∩ B| / (|A| + |B|)
            const dice = (targetDocCount + docCount > 0) ? (2 * coocCount) / (targetDocCount + docCount) : 0;

            // Normalized PMI (-1 to +1)
            // p(A) = targetDocCount / N, p(B) = docCount / N, p(A, B) = coocCount / N
            const pA = targetDocCount / N;
            const pB = docCount / N;
            const pAB = coocCount / N;
            let npmi = 0;
            if (pAB > 0 && pA > 0 && pB > 0) {
                const pmi = Math.log(pAB / (pA * pB));
                const norm = -Math.log(pAB);
                npmi = norm > 0 ? pmi / norm : 0;
            }

            // 総合スコア (Jaccardを基本に、共起頻度の対数を適度に加味)
            const score = jaccard * (1 + 0.2 * Math.log2(coocCount));

            candidates.push({
                word: w,
                score: Math.min(1.0, score),
                jaccard: Math.round(jaccard * 1000) / 1000,
                dice: Math.round(dice * 1000) / 1000,
                npmi: Math.round(npmi * 1000) / 1000,
                coocCount: coocCount,
                docCount: docCount,
                totalCount: wordFreq.get(w) || coocCount,
                checked: true // 初期状態は採用ON
            });
        }

        // もし候補が0件でminCooc > 1の場合は、minCooc=1に緩和して再試行
        if (candidates.length === 0 && minCooc > 1) {
            return this.findRelatedWords(tokensPerDoc, rawRows, textCol, targetKeyword, { ...options, minCooc: 1 });
        }

        // スコア降順にソートして上位N語を取得
        candidates.sort((a, b) => b.score - a.score || b.coocCount - a.coocCount);
        const relatedWords = candidates.slice(0, topN);

        return {
            targetKeyword: cleanKeyword,
            matchedTargetDocCount: targetDocCount,
            relatedWords: relatedWords,
            allDocCount: N
        };
    },

    /**
     * 指定キーワードおよび採用した関連語に基づいて対象意見（回答文）を抽出・フィルタリングする
     * @param {Array<object>} rawRows - 元のアンケート行配列
     * @param {string} textCol - 自由記述列名
     * @param {string} attrCol - 属性列名（任意）
     * @param {string} targetKeyword - ユーザー指定キーワード
     * @param {Array<string>} activeRelatedWords - ユーザーがチェックした関連語の配列
     * @param {Array<Array<string>>} tokensPerDoc - 各行の形態素トークン配列
     * @param {object} options - オプション (extractUnit: 'doc' | 'sentence')
     * @returns {object} フィルタリング結果
     */
    filterMatchedOpinions(rawRows, textCol, attrCol, targetKeyword, activeRelatedWords, tokensPerDoc, options = {}) {
        const searchWords = [targetKeyword, ...activeRelatedWords].filter(w => w && w.trim());
        const searchWordSet = new Set(searchWords.map(w => w.toLowerCase()));

        const matchedDocs = [];
        const N = rawRows.length;

        for (let i = 0; i < N; i++) {
            const row = rawRows[i];
            const originalText = String(row[textCol] || '');
            const lowerText = originalText.toLowerCase();
            const tokens = tokensPerDoc[i] || [];

            // マッチした単語を特定
            const hits = [];
            for (const sw of searchWords) {
                const lowerSw = sw.toLowerCase();
                if (lowerText.includes(lowerSw) || tokens.some(t => t.toLowerCase() === lowerSw)) {
                    hits.push(sw);
                }
            }

            if (hits.length > 0) {
                const hasKeyword = hits.includes(targetKeyword);
                matchedDocs.push({
                    originalIndex: i,
                    text: originalText,
                    attribute: attrCol && row[attrCol] != null ? String(row[attrCol]) : '',
                    tokens: tokens,
                    matchedWords: hits,
                    hasTargetKeyword: hasKeyword,
                    rawRow: row
                });
            }
        }

        return {
            totalDocs: N,
            matchedCount: matchedDocs.length,
            matchRate: N > 0 ? (matchedDocs.length / N) * 100 : 0,
            searchWords: searchWords,
            matchedDocs: matchedDocs
        };
    },

    /**
     * 抽出された意見群における単語統計（頻度、TF-IDF、共起行列）を算出する
     * 可視化（ワードクラウド、共起ネットワーク、UMAP）の入力データとなる
     * @param {Array<object>} matchedDocs - 抽出された回答配列
     * @param {Set<string>} stopWords - 除外語セット
     * @param {number} maxWords - 最大単語数
     * @returns {object} 単語統計データ
     */
    computeSubcorpusStats(matchedDocs, stopWords = new Set(), maxWords = 80) {
        const docCount = matchedDocs.length;
        if (docCount === 0) {
            return {
                wordList: [],
                wordCounts: {},
                docFreq: {},
                coocCounts: {},
                uniqueWordsPerDoc: []
            };
        }

        const wordCounts = {};
        const docFreq = {};
        const uniqueWordsPerDoc = [];

        // 1. 頻度および文書頻度の集計
        for (const doc of matchedDocs) {
            const tokens = doc.tokens || [];
            const docSet = new Set();
            for (const w of tokens) {
                if (stopWords.has(w)) continue;
                if (w.length <= 1 && !/^[A-Za-z0-9]+$/.test(w)) continue;

                wordCounts[w] = (wordCounts[w] || 0) + 1;
                docSet.add(w);
            }
            for (const w of docSet) {
                docFreq[w] = (docFreq[w] || 0) + 1;
            }
            uniqueWordsPerDoc.push(Array.from(docSet));
        }

        // 2. 単語ランキング（出現頻度順 ＆ TF-IDF順）
        const wordEntries = Object.entries(wordCounts).map(([w, cnt]) => {
            const df = docFreq[w] || 1;
            const idf = Math.log((docCount + 1) / (df + 0.5)) + 1;
            const tfidf = cnt * idf;
            return {
                text: w,
                count: cnt,
                df: df,
                tfidf: Math.round(tfidf * 100) / 100
            };
        });

        // 頻度降順ソート
        wordEntries.sort((a, b) => b.count - a.count);
        const topWords = wordEntries.slice(0, maxWords);
        const topWordSet = new Set(topWords.map(w => w.text));

        // 3. 共起行列（ペアの共起度）の集計
        const coocCounts = {};
        for (const uWords of uniqueWordsPerDoc) {
            const filteredWords = uWords.filter(w => topWordSet.has(w));
            const len = filteredWords.length;
            for (let i = 0; i < len; i++) {
                const w1 = filteredWords[i];
                for (let j = i + 1; j < len; j++) {
                    const w2 = filteredWords[j];
                    const key = w1 < w2 ? `${w1}|||${w2}` : `${w2}|||${w1}`;
                    coocCounts[key] = (coocCounts[key] || 0) + 1;
                }
            }
        }

        return {
            wordList: topWords,
            wordCounts: wordCounts,
            docFreq: docFreq,
            coocCounts: coocCounts,
            uniqueWordsPerDoc: uniqueWordsPerDoc
        };
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = AssociationEngine;
}
