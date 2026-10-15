/**
 * 意見集約・論点サマリーエンジン (summarizer.js)
 * 外部LLMを使用せず、ブラウザ内（ローカル）で統計的NLP・クラスタリング・構文解析により
 * 代表意見の自動選出（抽出型要約）、論点（トピック）サマリー、意見タイプ分類を行う
 */
const OpinionSummarizer = {
    // 意見タイプのパターン定義（ルールベース構文マッチ）
    OPINION_PATTERNS: {
        issue: [
            /困(る|って|り|った|難)/, /高(い|く|すぎる|騰|値)/, /負担/, /つら(い|く|さ)/, /苦し(い|く|さ)/,
            /できな(い|く)/, /厳し(い|く|さ)/, /大変/, /きつ(い|く|さ)/, /しんど(い|さ)/, /痛(い|手)/,
            /不便/, /悪化/, /不安/, /値上げ/, /値上が(り|る|った)/, /減少/, /削(る|り|って|減)/,
            /買(えない|い控え)/, /我慢/, /追いつ(かない|かず)/, /不満/, /問題/, /赤字/, /不足/, /上が(り|る)すぎ/
        ],
        request: [
            /してほし(い|かった|く)/, /てほし(い|かった|く)/, /べき(だ|である)?/, /望(む|ましい)/,
            /求(める|む)/, /対策(を|が|して)?/, /補助(を|が|金)?/, /支援(を|が|して)?/,
            /見直(し|す)/, /引き下(げ|げる)/, /安くして/, /改善(を|して|策)?/, /対応(して|を|願う)/,
            /導入(して|を)?/, /検討(して|を)?/, /拡大(して|を)?/, /整備/, /支給/, /お願い/, /頼む/
        ],
        positive: [
            /助か(る|った|り)/, /満足/, /良(い|かった|く)/, /ありがた(い|く|さ)/, /便利/,
            /うれし(い|かった)/, /感謝/, /安心/, /期待/, /好調/, /快適/, /素晴らし(い|く)/,
            /問題な(い|く)/, /影響は(ない|少ない)/, /気にな(らない|らず)/, /十分/, /助け/
        ]
    },

    /**
     * 1つのテキストの意見タイプ（意図・トーン）を判定する
     * @param {string} text - 対象テキスト
     * @returns {object} { type: 'issue'|'request'|'positive'|'neutral', label: string, color: string, icon: string }
     */
    classifyOpinionType(text) {
        if (!text) return { type: 'neutral', label: 'その他・中立', color: '#64748b', icon: '⚪' };

        const str = String(text);

        // 否定・軽微判定（「影響はない」「問題ない」などの場合、positive/neutralへ誘導）
        const isNegatedIssue = /影響(は|が)?(ない|ほとんどない|少ない)/.test(str) || /問題(は|が)?(ない|特になし)/.test(str);
        if (isNegatedIssue) {
            return { type: 'positive', label: '影響なし・良好', color: '#10b981', icon: '🟢' };
        }

        let issueScore = 0;
        let requestScore = 0;
        let positiveScore = 0;

        this.OPINION_PATTERNS.issue.forEach(p => { if (p.test(str)) issueScore += 1; });
        this.OPINION_PATTERNS.request.forEach(p => { if (p.test(str)) requestScore += 1.5; }); // 要望パターンは特徴的なので重み高め
        this.OPINION_PATTERNS.positive.forEach(p => { if (p.test(str)) positiveScore += 1.2; });

        if (issueScore === 0 && requestScore === 0 && positiveScore === 0) {
            return { type: 'neutral', label: 'その他・事実', color: '#64748b', icon: '⚪' };
        }

        if (requestScore > 0 && requestScore >= issueScore && requestScore >= positiveScore) {
            return { type: 'request', label: '要望・改善提案', color: '#0284c7', icon: '🔵' };
        }

        if (positiveScore > issueScore && positiveScore > requestScore) {
            return { type: 'positive', label: '肯定・満足', color: '#10b981', icon: '🟢' };
        }

        if (issueScore > 0) {
            return { type: 'issue', label: '困りごと・課題', color: '#e11d48', icon: '🔴' };
        }

        return { type: 'neutral', label: 'その他・事実', color: '#64748b', icon: '⚪' };
    },

    /**
     * 各意見文に適合度スコア（Relevance Score）を付与する
     * @param {Array<object>} matchedDocs - 抽出された回答文配列
     * @param {string} targetKeyword - 指定キーワード
     * @param {string} resolvedTargetWord - 代表ターゲット複合語
     * @param {Array<string>} activeRelatedWords - 選択された関連語
     */
    assignRelevanceScores(matchedDocs, targetKeyword, resolvedTargetWord, activeRelatedWords) {
        const targetLower = (targetKeyword || '').toLowerCase();
        const resolvedLower = (resolvedTargetWord || '').toLowerCase();
        const relatedSet = new Set((activeRelatedWords || []).map(w => w.toLowerCase()));

        for (const doc of matchedDocs) {
            const text = String(doc.text || '').toLowerCase();
            const tokens = doc.tokens || [];
            let score = 0;

            // 1. キーワードそのものを含むか (+10点)
            let hasKw = false;
            if (targetLower && (text.includes(targetLower) || tokens.some(t => t.toLowerCase() === targetLower))) {
                score += 10;
                hasKw = true;
            }
            if (resolvedLower && resolvedLower !== targetLower && (text.includes(resolvedLower) || tokens.some(t => t.toLowerCase() === resolvedLower))) {
                score += 8;
                hasKw = true;
            }

            // 2. 関連語の含有種類数 (+3点/種)
            let relatedKinds = 0;
            const foundRelated = new Set();
            for (const rw of relatedSet) {
                if (text.includes(rw) || tokens.some(t => t.toLowerCase() === rw)) {
                    foundRelated.add(rw);
                    score += 3;
                }
            }
            relatedKinds = foundRelated.size;

            // 3. トークン内のキーワード・関連語出現頻度密度
            let hitTokenCount = 0;
            tokens.forEach(t => {
                const tLower = t.toLowerCase();
                if (tLower === targetLower || tLower === resolvedLower || relatedSet.has(tLower)) {
                    hitTokenCount++;
                }
            });
            score += Math.min(6, hitTokenCount * 1.5);

            // 4. 文長による正規化（あまりに短すぎる「物価高」のみは低め、適度な文章長を優先）
            const len = doc.text.length;
            if (len >= 25 && len <= 180) {
                score += 3; // 読みやすい理想的な長さ
            } else if (len < 10) {
                score -= 3;
            }

            // 5. 否定文脈の検知
            const isNegated = /(影響(は|が)?(ない|ほとんどない|少ない)|困って(は)?(ない|いない)|問題(は|が)?ない)/.test(doc.text);
            doc.isNegated = isNegated;

            // 意見タイプの付与
            doc.opinionType = this.classifyOpinionType(doc.text);

            // 100点満点スケールに調整（最低10点、最高100点）
            const finalScore = Math.min(100, Math.max(10, Math.round(score * 3.5)));
            doc.relevanceScore = finalScore;
            doc.relatedKindCount = relatedKinds;
        }
    },

    /**
     * 文書間コサイン類似度セントロイド法（Centroid）により、
     * 意見群を最もよく代表している意見トップN文（抽出型要約）を選出する
     * @param {Array<object>} matchedDocs - 抽出された回答文配列
     * @param {object} subcorpusStats - computeSubcorpusStats の結果
     * @param {number} topN - 選出する文数（デフォルト4）
     * @returns {Array<object>} 代表意見の配列 [{ doc, score, reason }]
     */
    extractRepresentativeOpinions(matchedDocs, subcorpusStats, topN = 4) {
        if (!matchedDocs || matchedDocs.length === 0) return [];
        if (matchedDocs.length <= topN) {
            return matchedDocs.map((doc, idx) => ({
                doc: doc,
                score: 1.0,
                rank: idx + 1
            }));
        }

        const featureWords = (subcorpusStats && subcorpusStats.wordList)
            ? subcorpusStats.wordList.slice(0, 60).map(w => w.text)
            : [];

        if (featureWords.length === 0) {
            return matchedDocs.slice(0, topN).map((doc, idx) => ({ doc, score: 1.0, rank: idx + 1 }));
        }

        const F = featureWords.length;
        const wordIndex = new Map(featureWords.map((w, i) => [w, i]));
        const idfMap = new Map();
        const D = matchedDocs.length;

        // 特徴語のIDF算出
        featureWords.forEach(w => {
            const df = (subcorpusStats.docFreq && subcorpusStats.docFreq[w]) ? subcorpusStats.docFreq[w] : 1;
            idfMap.set(w, Math.log((D + 1) / (df + 0.5)) + 1);
        });

        // 各文書のTF-IDFベクトル化
        const docVectors = matchedDocs.map(d => {
            const vec = new Float64Array(F);
            const tokens = d.tokens || [];
            tokens.forEach(t => {
                if (wordIndex.has(t)) {
                    const idx = wordIndex.get(t);
                    const idf = idfMap.get(t) || 1.0;
                    vec[idx] += idf;
                }
            });
            // L2正規化
            let norm = 0;
            for (let f = 0; f < F; f++) norm += vec[f] * vec[f];
            norm = Math.sqrt(norm);
            if (norm > 0) {
                for (let f = 0; f < F; f++) vec[f] /= norm;
            }
            return vec;
        });

        // 全体の重心（Centroid）ベクトルの算出
        const centroid = new Float64Array(F);
        for (let i = 0; i < D; i++) {
            for (let f = 0; f < F; f++) {
                centroid[f] += docVectors[i][f];
            }
        }
        let cNorm = 0;
        for (let f = 0; f < F; f++) cNorm += centroid[f] * centroid[f];
        cNorm = Math.sqrt(cNorm);
        if (cNorm > 0) {
            for (let f = 0; f < F; f++) centroid[f] /= cNorm;
        }

        // 各文書とセントロイドとのコサイン類似度を計算し、文長ペナルティと適合度を加味
        const candidates = matchedDocs.map((doc, i) => {
            let sim = 0;
            for (let f = 0; f < F; f++) sim += docVectors[i][f] * centroid[f];

            // 文長ペナルティ: 40文字〜160文字を理想とし、短すぎる・長すぎる文を抑制
            const len = doc.text.length;
            let lenWeight = 1.0;
            if (len < 20) lenWeight = 0.5;
            else if (len < 35) lenWeight = 0.8;
            else if (len > 220) lenWeight = 0.75;

            // 適合度スコアを加味
            const relWeight = (doc.relevanceScore || 50) / 100;

            const finalRepScore = (sim * 0.6 + relWeight * 0.4) * lenWeight;

            return {
                doc: doc,
                similarity: sim,
                score: Math.round(finalRepScore * 1000) / 1000,
                vector: docVectors[i]
            };
        });

        // 類似度スコア降順ソート
        candidates.sort((a, b) => b.score - a.score);

        // 多様性（MMR: Maximal Marginal Relevance）を持たせて選出（同じ内容ばかりの文が連続するのを回避）
        const selected = [];
        const selectedIndices = new Set();

        // 1番目はスコア最高文
        if (candidates.length > 0) {
            selected.push(candidates[0]);
            selectedIndices.add(0);
        }

        while (selected.length < topN && selected.length < candidates.length) {
            let bestNextIdx = -1;
            let bestMmrScore = -Infinity;

            for (let i = 0; i < candidates.length; i++) {
                if (selectedIndices.has(i)) continue;
                const cand = candidates[i];

                // 既に選ばれた文との最大コサイン類似度
                let maxSimToSelected = 0;
                for (const s of selected) {
                    let dot = 0;
                    for (let f = 0; f < F; f++) dot += cand.vector[f] * s.vector[f];
                    if (dot > maxSimToSelected) maxSimToSelected = dot;
                }

                // MMR = λ * score - (1 - λ) * maxSimToSelected (λ=0.7)
                const mmr = 0.7 * cand.score - 0.3 * maxSimToSelected;
                if (mmr > bestMmrScore) {
                    bestMmrScore = mmr;
                    bestNextIdx = i;
                }
            }

            if (bestNextIdx >= 0) {
                selected.push(candidates[bestNextIdx]);
                selectedIndices.add(bestNextIdx);
            } else {
                break;
            }
        }

        return selected.map((item, idx) => ({
            rank: idx + 1,
            doc: item.doc,
            score: item.score
        }));
    },

    /**
     * クラスタリング結果に基づいて各論点（トピック）のサマリーカードデータを生成する
     * @param {Array<object>} matchedDocs - 抽出された回答文配列
     * @param {object} subcorpusStats - computeSubcorpusStats の結果
     * @param {Array<number>} clusterAssignments - 各文書のクラスタID配列
     * @param {number} kClusters - クラスタ数
     * @returns {Array<object>} 論点サマリー配列
     */
    generateTopicSummaries(matchedDocs, subcorpusStats, clusterAssignments, kClusters) {
        if (!matchedDocs.length || !clusterAssignments) return [];

        const clusters = [];
        for (let c = 0; c < kClusters; c++) {
            clusters.push({
                clusterId: c,
                docs: [],
                wordCounts: {},
                docFreq: {},
                opinionTypeCounts: { issue: 0, request: 0, positive: 0, neutral: 0 }
            });
        }

        matchedDocs.forEach((doc, idx) => {
            const cId = clusterAssignments[idx] != null ? clusterAssignments[idx] : 0;
            if (clusters[cId]) {
                clusters[cId].docs.push(doc);
                // 意見タイプの集計
                const type = (doc.opinionType && doc.opinionType.type) ? doc.opinionType.type : 'neutral';
                if (clusters[cId].opinionTypeCounts[type] !== undefined) {
                    clusters[cId].opinionTypeCounts[type]++;
                }
                // 単語出現の集計
                const tokens = doc.tokens || [];
                const seenInDoc = new Set();
                tokens.forEach(t => {
                    clusters[cId].wordCounts[t] = (clusters[cId].wordCounts[t] || 0) + 1;
                    if (!seenInDoc.has(t)) {
                        seenInDoc.add(t);
                        clusters[cId].docFreq[t] = (clusters[cId].docFreq[t] || 0) + 1;
                    }
                });
            }
        });

        const totalDocsCount = matchedDocs.length;
        const topicSummaries = [];

        clusters.forEach((cl, cIdx) => {
            if (cl.docs.length === 0) return;

            const cDocCount = cl.docs.length;
            const shareRate = Math.round((cDocCount / totalDocsCount) * 1000) / 10;

            // クラスタ特有の上位特徴語（TF-IDF）を算出
            const wordScored = Object.entries(cl.wordCounts).map(([w, cnt]) => {
                const df = cl.docFreq[w] || 1;
                // 全体でのDFとの比率でクラスタ特異度を強調
                const totalDf = (subcorpusStats && subcorpusStats.docFreq && subcorpusStats.docFreq[w]) ? subcorpusStats.docFreq[w] : df;
                const idf = Math.log((cDocCount + 1) / (df + 0.5)) + 1;
                const clusterScore = cnt * idf * (df / Math.max(1, totalDf));
                return { word: w, count: cnt, score: clusterScore };
            });

            wordScored.sort((a, b) => b.score - a.score);
            const topKeywords = wordScored.slice(0, 5).map(item => item.word);

            // クラスタ内の代表文を1〜2件選出（セントロイド法）
            const clStats = {
                wordList: wordScored.slice(0, 40).map(x => ({ text: x.word, count: x.count })),
                docFreq: cl.docFreq
            };
            const repOpinions = this.extractRepresentativeOpinions(cl.docs, clStats, 2);

            // 主な意見タイプの割り出し
            const sortedTypes = Object.entries(cl.opinionTypeCounts).sort((a, b) => b[1] - a[1]);
            const primaryType = sortedTypes[0][0];

            topicSummaries.push({
                topicId: cIdx + 1,
                name: `論点 ${cIdx + 1}: ${topKeywords.slice(0, 3).join('・')}`,
                keywords: topKeywords,
                docCount: cDocCount,
                shareRate: shareRate,
                primaryType: primaryType,
                typeBreakdown: cl.opinionTypeCounts,
                representativeOpinions: repOpinions.map(r => r.doc),
                docs: cl.docs
            });
        });

        // 該当件数が多い順にソート
        topicSummaries.sort((a, b) => b.docCount - a.docCount);
        // ソート後に論点番号を再付与
        topicSummaries.forEach((t, i) => {
            t.displayRank = i + 1;
            t.name = `論点 ${i + 1}: ${t.keywords.slice(0, 3).join('・')}`;
        });

        return topicSummaries;
    },

    /**
     * 全体コーパスと比較した特異度（オッズ比 / 特徴倍率）上位単語を算出する
     * @param {object} totalStats - 全体コーパス統計
     * @param {object} subStats - 抽出意見コーパス統計
     * @param {number} topN - 取得件数
     * @returns {Array<object>} [{ word, oddsRatio, matchedRate, totalRate }]
     */
    computeOddsRatioKeywords(totalStats, subStats, topN = 10) {
        if (!totalStats || !subStats || !subStats.wordList) return [];

        const totalDocs = totalStats.docCount || 1;
        const matchedDocs = (subStats.uniqueWordsPerDoc && subStats.uniqueWordsPerDoc.length) || 1;

        const results = [];
        const seenWords = new Set();

        subStats.wordList.forEach(wItem => {
            const w = wItem.text;
            if (seenWords.has(w)) return;
            seenWords.add(w);

            const matchedDf = (subStats.docFreq && subStats.docFreq[w]) ? subStats.docFreq[w] : 1;
            // 全体でのDF（近似: totalStatsの単語頻度または推定）
            const totalDf = (totalStats.docFreq && totalStats.docFreq[w]) ? totalStats.docFreq[w] : matchedDf;

            const matchedRate = (matchedDf / matchedDocs);
            const totalRate = Math.max(0.0001, (totalDf / totalDocs));

            // オッズ比（何倍使われやすいか）
            const oddsRatio = matchedRate / totalRate;

            if (matchedDf >= 2) { // 最低2件以上出現
                results.push({
                    word: w,
                    count: wItem.count,
                    matchedDf: matchedDf,
                    oddsRatio: Math.round(oddsRatio * 10) / 10,
                    matchedRatePercent: Math.round(matchedRate * 1000) / 10,
                    totalRatePercent: Math.round(totalRate * 1000) / 10
                });
            }
        });

        results.sort((a, b) => b.oddsRatio - a.oddsRatio || b.count - a.count);
        return results.slice(0, topN);
    },

    /**
     * Markdown形式の要約レポートを生成する
     * @param {object} summaryData - 集約データ一式
     * @returns {string} Markdown文字列
     */
    generateMarkdownReport(summaryData) {
        const {
            targetKeyword,
            resolvedTargetWord,
            filterResult,
            repOpinions,
            topicSummaries,
            oddsRatioKeywords,
            opinionTypeSummary
        } = summaryData;

        const lines = [];
        const today = new Date().toISOString().split('T')[0];

        lines.push(`# アンケート意見深掘り＆集約レポート`);
        lines.push(`- **作成日**: ${today}`);
        lines.push(`- **分析キーワード**: ${targetKeyword}${resolvedTargetWord && resolvedTargetWord !== targetKeyword ? `（中心代表語: ${resolvedTargetWord}）` : ''}`);
        lines.push(`- **該当意見数**: ${filterResult.matchedCount.toLocaleString()} 件 / 全 ${filterResult.totalDocs.toLocaleString()} 件（該当率: ${filterResult.matchRate.toFixed(1)}%）`);
        lines.push(``);

        // 意見タイプ構成
        if (opinionTypeSummary) {
            lines.push(`## 1. 意見タイプ構成`);
            lines.push(`- 🔴 **困りごと・課題**: ${opinionTypeSummary.issueCount} 件 (${opinionTypeSummary.issueRate}%)`);
            lines.push(`- 🔵 **要望・改善提案**: ${opinionTypeSummary.requestCount} 件 (${opinionTypeSummary.requestRate}%)`);
            lines.push(`- 🟢 **肯定・満足**: ${opinionTypeSummary.positiveCount} 件 (${opinionTypeSummary.positiveRate}%)`);
            lines.push(`- ⚪ **その他・事実**: ${opinionTypeSummary.neutralCount} 件 (${opinionTypeSummary.neutralRate}%)`);
            lines.push(``);
        }

        // 代表意見（抽出型要約）
        if (repOpinions && repOpinions.length > 0) {
            lines.push(`## 2. 全体代表意見（抽出型要約 トップ${repOpinions.length}）`);
            repOpinions.forEach((rep, idx) => {
                const attrText = rep.doc.attribute ? ` [${rep.doc.attribute}]` : '';
                const typeIcon = (rep.doc.opinionType && rep.doc.opinionType.icon) ? rep.doc.opinionType.icon : '💬';
                lines.push(`${idx + 1}. ${typeIcon} **${rep.doc.opinionType ? rep.doc.opinionType.label : '意見'}**${attrText}`);
                lines.push(`   > 「${rep.doc.text.trim()}」`);
            });
            lines.push(``);
        }

        // 主要論点（トピック別サマリー）
        if (topicSummaries && topicSummaries.length > 0) {
            lines.push(`## 3. 主要な論点（トピック別サマリー）`);
            topicSummaries.forEach(topic => {
                lines.push(`### ${topic.name}（${topic.docCount}件 / ${topic.shareRate}%）`);
                lines.push(`- **特徴キーワード**: \`${topic.keywords.join('`, `')}\``);
                if (topic.representativeOpinions && topic.representativeOpinions.length > 0) {
                    lines.push(`- **代表的な生の声**:`);
                    topic.representativeOpinions.forEach(op => {
                        const attrText = op.attribute ? ` (${op.attribute})` : '';
                        lines.push(`  - 「${op.text.trim()}」${attrText}`);
                    });
                }
                lines.push(``);
            });
        }

        // 全体比の際立った特徴語
        if (oddsRatioKeywords && oddsRatioKeywords.length > 0) {
            lines.push(`## 4. 全体と比較した特異キーワード（出現率オッズ比上位）`);
            lines.push(`| 単語 | 出現回数 | この意見群での出現率 | 全体での出現率 | 特異度倍率 |`);
            lines.push(`|:---|:---|:---|:---|:---|`);
            oddsRatioKeywords.forEach(k => {
                lines.push(`| ${k.word} | ${k.count}回 | ${k.matchedRatePercent}% | ${k.totalRatePercent}% | **${k.oddsRatio}倍** |`);
            });
            lines.push(``);
        }

        lines.push(`---`);
        lines.push(`*Generated by Survey Focus Explorer (完全ローカル処理)*`);

        return lines.join('\n');
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = OpinionSummarizer;
}
