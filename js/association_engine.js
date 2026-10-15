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
        // 形態素トークンにおける完全一致、および複合語（例: "中東" に対する "中東情勢"）の探索
        const lowerKeyword = cleanKeyword.toLowerCase();
        const exactTokenExists = wordDocMap.has(cleanKeyword);
        let targetDocSet = wordDocMap.get(cleanKeyword) || new Set();

        // キーワードを部分一致で含む複合語トークンの探索（例: "中東" に対して "中東情勢" "中東問題" 等）
        const compoundCandidates = [];
        for (const [w, docSet] of wordDocMap.entries()) {
            const wLower = w.toLowerCase();
            if (wLower !== lowerKeyword && (wLower.includes(lowerKeyword) || lowerKeyword.includes(wLower))) {
                compoundCandidates.push({ word: w, count: wordFreq.get(w) || 0, docCount: docSet.size });
            }
        }
        compoundCandidates.sort((a, b) => b.count - a.count || b.docCount - a.docCount);

        // 代表ターゲット語（中心語）の解決:
        // トークンに完全一致がない場合、最も出現頻度が高い複合語（例: "中東情勢"）を中心語として自動解決
        let resolvedTargetWord = cleanKeyword;
        if (!exactTokenExists && compoundCandidates.length > 0) {
            resolvedTargetWord = compoundCandidates[0].word;
        }

        // もし形態素トークンに完全一致しない場合、複合語の文書集合および原文テキスト部分一致で補完
        if (targetDocSet.size === 0) {
            targetDocSet = new Set();
            // 代表複合語の文書を追加
            if (wordDocMap.has(resolvedTargetWord)) {
                for (const idx of wordDocMap.get(resolvedTargetWord)) {
                    targetDocSet.add(idx);
                }
            }
            // 他の複合語の文書も追加
            for (const cand of compoundCandidates) {
                const cSet = wordDocMap.get(cand.word);
                if (cSet) {
                    for (const idx of cSet) targetDocSet.add(idx);
                }
            }
            // 原文テキストでの部分一致検索
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
                resolvedTargetWord: resolvedTargetWord,
                matchedTargetDocCount: 0,
                relatedWords: [],
                allDocCount: N,
                warning: `キーワード「${cleanKeyword}」を含む回答が見つかりませんでした。`
            };
        }

        // 3. 他の各単語との共起度（Jaccard係数 ＆ 自己相互情報量PMI）を計算
        const candidates = [];
        const targetDocArray = Array.from(targetDocSet);

        // 関連語から除外する自単語・代表語セット（中心語そのものが関連語一覧に混ざるのを防止）
        // ※「大雪」「雪道」などの派生語・複合語は重要な関連語であるため除外しない
        const targetWordVariants = new Set([
            cleanKeyword.toLowerCase(),
            resolvedTargetWord.toLowerCase()
        ]);

        for (const [w, docSet] of wordDocMap.entries()) {
            const wLower = w.toLowerCase();
            // 自単語および解決された代表中心語は除外（中心語として扱うため関連語リストには出さない）
            if (targetWordVariants.has(wLower)) continue;

            const isKanji = /^[\p{Script=Han}]$/u.test(w);
            const isAlphaNum = /^[A-Za-z0-9]+$/.test(w);
            const isTarget = (wLower === cleanKeyword.toLowerCase() || wLower === resolvedTargetWord.toLowerCase());
            if (w.length <= 1 && !isKanji && !isAlphaNum && !isTarget) continue; // 漢字・英数以外の1文字記号・ひらがな等はスキップ

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
            resolvedTargetWord: resolvedTargetWord,
            hasExactToken: exactTokenExists,
            compoundCandidates: compoundCandidates.map(c => c.word),
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
        const resolvedTargetWord = options.resolvedTargetWord || targetKeyword;
        const matchMode = options.matchMode || 'or'; // 'or' | 'and'
        const extractUnit = options.extractUnit || 'doc'; // 'doc' | 'sentence'

        // ターゲットキーワード、代表ターゲット複合語、およびチェックされた関連語
        const searchWords = [targetKeyword, resolvedTargetWord, ...activeRelatedWords].filter(w => w && w.trim());
        const uniqueSearchWords = Array.from(new Set(searchWords));
        const searchWordSet = new Set(uniqueSearchWords.map(w => w.toLowerCase()));

        const matchedDocs = [];
        const N = rawRows.length;
        const targetLower = (targetKeyword || '').toLowerCase();
        const resolvedLower = (resolvedTargetWord || '').toLowerCase();
        const activeRelatedLowerSet = new Set((activeRelatedWords || []).map(w => w.toLowerCase()));

        for (let i = 0; i < N; i++) {
            const row = rawRows[i];
            const originalText = String(row[textCol] || '');
            const lowerText = originalText.toLowerCase();
            const tokens = tokensPerDoc[i] || [];

            // マッチした単語を特定
            const hits = [];
            for (const sw of uniqueSearchWords) {
                const lowerSw = sw.toLowerCase();
                if (lowerText.includes(lowerSw) || tokens.some(t => t.toLowerCase() === lowerSw)) {
                    hits.push(sw);
                }
            }

            if (hits.length > 0) {
                // キーワードそのもの、解決された代表語、またはキーワードを含む複合語が含まれているか判定
                const hasKeyword = hits.some(h => {
                    const hLower = h.toLowerCase();
                    return hLower === targetLower || hLower === resolvedLower || (targetLower && hLower.includes(targetLower));
                }) || lowerText.includes(targetLower) || lowerText.includes(resolvedLower) ||
                   tokens.some(t => {
                       const tLower = t.toLowerCase();
                       return tLower === targetLower || tLower === resolvedLower || (targetLower && tLower.includes(targetLower));
                   });

                const hasRelatedWord = hits.some(h => activeRelatedLowerSet.has(h.toLowerCase()));

                // AND条件判定: キーワード必須かつ、関連語がある場合は関連語のいずれかも必須
                let isMatch = false;
                if (matchMode === 'and') {
                    if (activeRelatedWords.length > 0) {
                        isMatch = hasKeyword && hasRelatedWord;
                    } else {
                        isMatch = hasKeyword;
                    }
                } else {
                    // OR条件（現行）
                    isMatch = true;
                }

                if (isMatch) {
                    let processedText = originalText;
                    let focusedSentences = [];

                    // 文（センテンス）単位の抽出モード処理
                    if (extractUnit === 'sentence') {
                        // 句点や改行で文に分割
                        const rawSentences = originalText.split(/([。！？\n]+)/).filter(Boolean);
                        const sentences = [];
                        for (let sIdx = 0; sIdx < rawSentences.length; sIdx += 2) {
                            const sentText = (rawSentences[sIdx] || '') + (rawSentences[sIdx + 1] || '');
                            if (sentText.trim()) sentences.push(sentText.trim());
                        }

                        // キーワードまたは関連語を含む文を抽出
                        const matchingSentences = sentences.filter(sent => {
                            const sLower = sent.toLowerCase();
                            return uniqueSearchWords.some(sw => sLower.includes(sw.toLowerCase()));
                        });

                        if (matchingSentences.length > 0) {
                            focusedSentences = matchingSentences;
                            processedText = matchingSentences.join(' ');
                        }
                    }

                    matchedDocs.push({
                        originalIndex: i,
                        text: processedText,
                        fullOriginalText: originalText,
                        focusedSentences: focusedSentences,
                        attribute: attrCol && row[attrCol] != null ? String(row[attrCol]) : '',
                        tokens: tokens,
                        matchedWords: hits,
                        hasTargetKeyword: hasKeyword,
                        hasRelatedWord: hasRelatedWord,
                        rawRow: row
                    });
                }
            }
        }

        // 適合度スコアおよび意見タイプ（トーン）の付与（OpinionSummarizerが存在する場合）
        if (typeof OpinionSummarizer !== 'undefined' && OpinionSummarizer.assignRelevanceScores) {
            OpinionSummarizer.assignRelevanceScores(matchedDocs, targetKeyword, resolvedTargetWord, activeRelatedWords);
        }

        return {
            totalDocs: N,
            matchedCount: matchedDocs.length,
            matchRate: N > 0 ? (matchedDocs.length / N) * 100 : 0,
            searchWords: uniqueSearchWords,
            matchedDocs: matchedDocs,
            matchMode: matchMode,
            extractUnit: extractUnit
        };
    },

    /**
     * 抽出された意見群における単語統計（頻度、TF-IDF、共起行列）を算出する
     * 可視化（ワードクラウド、共起ネットワーク、UMAP）の入力データとなる
     * @param {Array<object>} matchedDocs - 抽出された回答配列
     * @param {Set<string>} stopWords - 除外語セット
     * @param {number} maxWords - 最大単語数
     * @param {object} options - オプション (targetKeyword, resolvedTargetWord など)
     * @returns {object} 単語統計データ
     */
    computeSubcorpusStats(matchedDocs, stopWords = new Set(), maxWords = 80, options = {}) {
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

        const targetKeyword = options.targetKeyword || '';
        const resolvedTargetWord = options.resolvedTargetWord || targetKeyword;

        const wordCounts = {};
        const docFreq = {};
        const uniqueWordsPerDoc = [];

        // 1. 頻度および文書頻度の集計
        for (const doc of matchedDocs) {
            const tokens = doc.tokens || [];
            const docSet = new Set();
            for (const w of tokens) {
                if (stopWords.has(w)) continue;
                const isKanji = /^[\p{Script=Han}]$/u.test(w);
                const isAlphaNum = /^[A-Za-z0-9]+$/.test(w);
                const isTarget = (w.toLowerCase() === targetKeyword.toLowerCase() || w.toLowerCase() === resolvedTargetWord.toLowerCase());
                if (w.length <= 1 && !isKanji && !isAlphaNum && !isTarget) continue;

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

        // 代表ターゲット語およびキーワードがもし集計内に存在すれば、上位リストに確実に残す
        const targetsToKeep = [resolvedTargetWord, targetKeyword].filter(w => w && wordCounts[w]);
        let topWords = wordEntries.slice(0, maxWords);
        for (const tw of targetsToKeep) {
            if (!topWords.some(item => item.text === tw)) {
                const foundItem = wordEntries.find(item => item.text === tw);
                if (foundItem) {
                    if (topWords.length >= maxWords) topWords.pop();
                    topWords.unshift(foundItem); // 先頭付近に確実に保持
                }
            }
        }
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
    },

    /**
     * 全体コーパスと抽出意見サブコーパスの比較統計（カバレッジ統計）を算出
     * @param {object} totalStats - TextPreprocessor.computeCorpusStats の結果
     * @param {Array<object>} matchedDocs - 抽出意見配列
     * @param {object} subcorpusStats - computeSubcorpusStats の結果
     * @returns {object} カバレッジ比較データ
     */
    computeCoverageStats(totalStats, matchedDocs, subcorpusStats) {
        if (!totalStats) return null;
        const matchedDocCount = matchedDocs.length;
        let matchedChars = 0;
        let matchedTotalTokens = 0;
        const matchedVocabSet = new Set();
        const matchedPosBreakdown = { 名詞: 0, 動詞: 0, 形容詞: 0, 副詞: 0, その他: 0 };

        for (const doc of matchedDocs) {
            matchedChars += String(doc.text || '').length;
            const tokens = doc.tokens || [];
            matchedTotalTokens += tokens.length;
            for (const t of tokens) {
                matchedVocabSet.add(t);
                const pos = (typeof TextPreprocessor !== 'undefined' && TextPreprocessor.wordPosMap)
                    ? (TextPreprocessor.wordPosMap.get(t) || '名詞')
                    : '名詞';
                if (matchedPosBreakdown[pos] !== undefined) matchedPosBreakdown[pos]++;
                else matchedPosBreakdown.その他++;
            }
        }

        const docRate = totalStats.docCount > 0 ? (matchedDocCount / totalStats.docCount) * 100 : 0;
        const charRate = totalStats.totalChars > 0 ? (matchedChars / totalStats.totalChars) * 100 : 0;
        const tokenRate = totalStats.totalTokens > 0 ? (matchedTotalTokens / totalStats.totalTokens) * 100 : 0;
        const vocabRate = totalStats.uniqueVocabCount > 0 ? (matchedVocabSet.size / totalStats.uniqueVocabCount) * 100 : 0;

        return {
            total: totalStats,
            matched: {
                docCount: matchedDocCount,
                totalChars: matchedChars,
                avgCharsPerDoc: matchedDocCount > 0 ? Math.round((matchedChars / matchedDocCount) * 10) / 10 : 0,
                totalTokens: matchedTotalTokens,
                uniqueVocabCount: matchedVocabSet.size,
                posBreakdown: matchedPosBreakdown
            },
            coverage: {
                docRate: Math.round(docRate * 10) / 10,
                charRate: Math.round(charRate * 10) / 10,
                tokenRate: Math.round(tokenRate * 10) / 10,
                vocabRate: Math.round(vocabRate * 10) / 10
            }
        };
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = AssociationEngine;
}
