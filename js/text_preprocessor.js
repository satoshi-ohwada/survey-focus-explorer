/**
 * テキスト前処理モジュール
 * Kuromoji.jsを利用して形態素解析、不要語除去（ストップワード）、複合名詞結合、
 * カスタム辞書（複合語・除外語・表記ゆれ統一）、およびTF-IDF計算を行う
 */
const TextPreprocessor = {
    tokenizer: null,
    isInitializing: false,

    // デフォルトの標準ストップワード（data/stopwords.txt および既存リストを統合したセット）
    DEFAULT_STOPWORDS: new Set(
        typeof DEFAULT_STOPWORDS_LIST !== 'undefined'
            ? DEFAULT_STOPWORDS_LIST
            : [
                'こと', 'もの', 'ため', 'よう', 'そう', 'これ', 'それ', 'あれ', 'どれ',
                'ところ', 'とき', '時', '事', '物', '方', '人', '者', '点', '分', '回',
                'さん', '様', '私', '僕', '自分', '貴社', '御社',
                'する', 'ある', 'いる', 'なる', 'れる', 'られる', 'せる', 'させる',
                'ない', 'よい', 'いい', '思う', '感じる', '考える', '言う', 'みる',
                'できる', 'わかる', '持つ', 'いく', 'くる', 'おく', 'しまう',
                '使う', '利用', '希望', '要望', 'お願い', '頂く', 'いただく', 'くださる',
                '非常', '大変', 'かなり', '少し', 'ちょっと', 'もっと', '全体', '一部',
                '質問', '回答', 'アンケート', '意見', '感想', '理由', '今日', '今後', '今回'
            ]
    ),

    // ユーザー定義のカスタムルール
    customStopWords: new Set(),
    customCompoundWords: new Set(),
    customSynonymRules: new Map(),

    // 無意味な回答（行全体がこれに該当する場合はスキップ）
    JUNK_RESPONSES: new Set([
        // 日本語定型無効・無回答・空欄相当表記
        'なし', '特になし', '特にありません', 'ありません', 'ない', 'とくになし',
        '特にない', '無し', '特に無し', '無', '無回答', '未記入', '未入力', '無記入',
        '回答なし', '回答無', '回答不可', '特記なし', '特記無', '特段なし', '特になしです',
        '特にありませんでした', 'ありませんでした', '特にないです', 'ないです',
        '不明', '不詳', '該当なし', '該当項目なし', '該当者なし', '対象外', '同上', '〃',
        // 英語定型・欠損値表現（小文字正規化して照合）
        'na', 'n/a', 'none', 'nothing', 'null', 'nan', 'undefined', 'nil'
    ]),

    /**
     * Kuromoji トークナイザーおよびストップワードの初期化
     * @param {string} dicPath 
     * @returns {Promise<any>}
     */
    async init(dicPath = 'lib/kuromoji/dict/') {
        // data/stopwords.txt があれば fetch して取り込み（CORS等で失敗しても DEFAULT_STOPWORDS_LIST で動作）
        try {
            if (typeof fetch !== 'undefined') {
                const resp = await fetch('data/stopwords.txt');
                if (resp.ok) {
                    const txt = await resp.text();
                    const words = txt.split('\n')
                        .map(l => l.trim())
                        .filter(l => l.length > 0 && !l.startsWith('#'));
                    words.forEach(w => this.DEFAULT_STOPWORDS.add(w));
                }
            }
        } catch (e) {
            // ローカルファイル実行等の場合は内蔵リストをそのまま使用
            console.log('Using built-in default stopwords.');
        }

        if (this.tokenizer) return this.tokenizer;
        if (this.isInitializing) {
            while (this.isInitializing) {
                await new Promise(r => setTimeout(r, 100));
            }
            return this.tokenizer;
        }

        this.isInitializing = true;
        return new Promise((resolve, reject) => {
            if (typeof kuromoji === 'undefined') {
                this.isInitializing = false;
                return reject(new Error('Kuromojiライブラリが読み込まれていません'));
            }

            kuromoji.builder({ dicPath }).build((err, tokenizer) => {
                this.isInitializing = false;
                if (err) {
                    reject(err);
                } else {
                    this.tokenizer = tokenizer;
                    resolve(tokenizer);
                }
            });
        });
    },

    /**
     * カスタムルールの一括設定
     * @param {{ stopWords?: Set|string[], compoundWords?: Set|string[], synonymRules?: Map|Array<[string,string]> }} rules
     */
    setCustomRules(rules = {}) {
        if (rules.stopWords) {
            this.customStopWords = rules.stopWords instanceof Set ? new Set(rules.stopWords) : new Set(rules.stopWords);
        }
        if (rules.compoundWords) {
            this.customCompoundWords = rules.compoundWords instanceof Set ? new Set(rules.compoundWords) : new Set(rules.compoundWords);
        }
        if (rules.synonymRules) {
            this.customSynonymRules = rules.synonymRules instanceof Map ? new Map(rules.synonymRules) : new Map(rules.synonymRules);
        }
    },

    /**
     * テキストの入力品質を判定する（プレビューおよびデータ検証用）
     * @param {string} text 
     * @returns {{ status: 'valid' | 'empty' | 'junk', label: string, isProblem: boolean, detail: string }}
     */
    checkQuality(text) {
        if (text === undefined || text === null) {
            return { status: 'empty', label: '空欄', isProblem: true, detail: '未入力です（分析から除外されます）' };
        }
        const textStr = String(text).trim();
        if (textStr.length === 0) {
            return { status: 'empty', label: '空欄', isProblem: true, detail: '空白のみです（分析から除外されます）' };
        }

        const cleaned = textStr.replace(/[\s\r\n\t　。、・,.()（）「」『』【】\[\]]/g, '');
        if (cleaned.length === 0) {
            return { status: 'empty', label: '記号・空白のみ', isProblem: true, detail: '記号や空白のみのため分析対象外です' };
        }

        const lowerCleaned = cleaned.toLowerCase();

        // 記号・ハイフンのみ（例: ---, ***, ///, ――, ・・・ など）
        if (/^[^\p{L}\p{N}]+$/u.test(cleaned)) {
            return { status: 'junk', label: '記号のみ', isProblem: true, detail: '記号・ハイフンのみのため分析対象外です' };
        }

        // 定型スキップ単語・欠損値表記に合致する場合
        if (this.JUNK_RESPONSES.has(cleaned) || this.JUNK_RESPONSES.has(lowerCleaned)) {
            return { status: 'junk', label: '定型無効', isProblem: true, detail: '「なし」「特になし」「N/A」等の定型回答のため分析対象外です' };
        }

        // 数字のみ（例: 999, 0, 99 などコード番号）
        if (/^[0-9０-９]+$/.test(cleaned)) {
            return { status: 'junk', label: '数値コード', isProblem: true, detail: 'アンケートコード等の数値のみのため分析対象外です' };
        }

        // 文字数が極端に短い（1文字のみ）
        if (cleaned.length <= 1) {
            return { status: 'junk', label: '極短文', isProblem: true, detail: '1文字以下のため分析対象外です' };
        }

        return { status: 'valid', label: '正常', isProblem: false, detail: '有効なテキストです' };
    },

    /**
     * テキストが無意味回答かどうかを判定
     * @param {string} text 
     * @returns {boolean}
     */
    isJunkResponse(text) {
        return this.checkQuality(text).isProblem;
    },

    /**
     * カスタム複合語の一致および表記ゆれ（同義語）の置換をトークン列に適用
     * 最長一致優先で結合・置換を行う
     * @param {Array<object>} tokens 
     * @returns {Array<object>}
     */
    mergeCompoundsAndSynonyms(tokens) {
        if (!tokens || tokens.length === 0) return tokens || [];
        const hasCompounds = this.customCompoundWords && this.customCompoundWords.size > 0;
        const hasSynonyms = this.customSynonymRules && this.customSynonymRules.size > 0;
        if (!hasCompounds && !hasSynonyms) return tokens;

        // 検索文字列のリストを作成（複合語 + 置換元の語）
        const searchKeys = Array.from(new Set([
            ...(hasCompounds ? Array.from(this.customCompoundWords) : []),
            ...(hasSynonyms ? Array.from(this.customSynonymRules.keys()) : [])
        ]));

        // 最長一致のため文字列長降順でソート
        const searchStrings = searchKeys.sort((a, b) => b.length - a.length);

        const mergedTokens = [];
        let i = 0;
        while (i < tokens.length) {
            let matched = false;
            for (const cw of searchStrings) {
                let combinedStr = "";
                let j = i;
                while (j < tokens.length) {
                    combinedStr += tokens[j].surface_form;
                    j++;
                    if (combinedStr === cw) {
                        break;
                    }
                    if (!cw.startsWith(combinedStr)) {
                        break;
                    }
                }

                if (combinedStr === cw || combinedStr.replace(/\s+/g, '') === cw.replace(/\s+/g, '')) {
                    const isSynonym = hasSynonyms && this.customSynonymRules.has(cw);
                    const targetWord = isSynonym ? this.customSynonymRules.get(cw) : cw;

                    mergedTokens.push({
                        surface_form: targetWord,
                        pos: '名詞',
                        pos_detail_1: isSynonym ? '同義語' : '複合語',
                        basic_form: targetWord
                    });
                    i = j;
                    matched = true;
                    break;
                }
            }
            if (!matched) {
                mergedTokens.push(tokens[i]);
                i++;
            }
        }
        return mergedTokens;
    },

    /**
     * 単語がストップワード（除外語）かどうか判定
     * @param {string} word 
     * @returns {boolean}
     */
    isStopWord(word) {
        if (!word) return true;
        return this.DEFAULT_STOPWORDS.has(word) || this.customStopWords.has(word);
    },

    /**
     * 単一のテキスト文を形態素解析し、単語リスト（名詞・動詞・形容詞・複合語）を返す
     * 1. ユーザー定義複合語・同義語置換の適用
     * 2. 連続する名詞の自動結合
     * 3. ストップワード（標準＋カスタム除外語）のフィルタリング
     * @param {string} text 
     * @returns {string[]}
     */
    tokenize(text) {
        if (!this.tokenizer || !text) return [];

        let tokens = this.tokenizer.tokenize(text);

        // 1. カスタム複合語と表記ゆれの結合・置換
        tokens = this.mergeCompoundsAndSynonyms(tokens);

        const resultWords = [];
        let compoundNoun = '';

        const flushCompoundNoun = () => {
            if (compoundNoun.length >= 2 && !this.isStopWord(compoundNoun)) {
                // 数字のみ、または記号のみの単語は除外
                if (!/^[0-9０-９]+$/.test(compoundNoun) && !/^[^\p{L}\p{N}]+$/u.test(compoundNoun)) {
                    resultWords.push(compoundNoun);
                }
            }
            compoundNoun = '';
        };

        for (let i = 0; i < tokens.length; i++) {
            const t = tokens[i];
            const pos = t.pos;
            const posDetail = t.pos_detail_1;
            const basicForm = (t.basic_form && t.basic_form !== '*') ? t.basic_form : t.surface_form;

            // ユーザー登録の複合語または同義語置換されたトークンの場合（独立した1単語として確定）
            if (posDetail === '複合語' || posDetail === '同義語') {
                flushCompoundNoun();
                const word = basicForm;
                if (word.length >= 2 && !this.isStopWord(word)) {
                    resultWords.push(word);
                }
                continue;
            }

            // 名詞の場合（非自立・代名詞・数・接尾を除く）
            if (pos === '名詞') {
                if (posDetail === '非自立' || posDetail === '代名詞' || posDetail === '数' || posDetail === '接尾') {
                    flushCompoundNoun();
                    continue;
                }
                // 連続名詞として蓄積
                compoundNoun += t.surface_form;
            } else {
                // 名詞以外が来たら複合名詞を確定
                flushCompoundNoun();

                // 動詞または形容詞の場合（自立語のみ）
                if (pos === '動詞' || pos === '形容詞') {
                    if (posDetail === '自立' || posDetail === '*') {
                        if (basicForm.length >= 2 && !this.isStopWord(basicForm)) {
                            resultWords.push(basicForm);
                        }
                    }
                }
            }
        }
        flushCompoundNoun();

        return resultWords;
    },

    /**
     * 全回答のテキストを処理し、文書-単語行列およびTF-IDFを計算する
     * @param {Array<{id: any, text: string, row: object}>} validResponses 
     * @param {number} maxVocabSize 最大語彙数（デフォルト60）
     * @returns {{
     *   vocabulary: string[],
     *   matrix: number[][],
     *   wordDocCounts: Record<string, number>,
     *   docWordLists: string[][]
     * }}
     */
    buildTfIdfMatrix(validResponses, maxVocabSize = 60) {
        const N = validResponses.length;
        if (N === 0) {
            return { vocabulary: [], matrix: [], wordDocCounts: {}, docWordLists: [] };
        }

        // 1. 各回答の単語リストを抽出
        const docWordLists = validResponses.map(r => this.tokenize(r.text));

        // 2. 単語の文書頻度 (DF) をカウント
        const docFreq = {};
        docWordLists.forEach(words => {
            const uniqueWords = new Set(words);
            uniqueWords.forEach(w => {
                docFreq[w] = (docFreq[w] || 0) + 1;
            });
        });

        // 3. 語彙の選定（稀な単語や全文書に渡る一般的すぎる単語をフィルタ）
        const minDf = N >= 20 ? 2 : 1;
        const maxDf = N <= 10 ? N : Math.max(3, Math.floor(N * 0.85));

        let candidateWords = Object.keys(docFreq).filter(w => {
            const df = docFreq[w];
            return df >= minDf && df <= maxDf;
        });

        // 候補語が少なすぎる場合は閾値を緩和して全語彙を採用
        if (candidateWords.length < 3) {
            candidateWords = Object.keys(docFreq);
        }

        // TF-IDF スコアの総和で単語をランキングして上位 maxVocabSize を選ぶ
        const wordScores = {};
        candidateWords.forEach(w => {
            const idf = Math.log(N / (docFreq[w] + 1)) + 1;
            let tfSum = 0;
            docWordLists.forEach(words => {
                const count = words.filter(word => word === w).length;
                if (count > 0) {
                    tfSum += (1 + Math.log(count));
                }
            });
            wordScores[w] = tfSum * idf;
        });

        const sortedVocab = candidateWords
            .sort((a, b) => (wordScores[b] || 0) - (wordScores[a] || 0))
            .slice(0, maxVocabSize);

        const vocabIndexMap = new Map();
        sortedVocab.forEach((w, idx) => vocabIndexMap.set(w, idx));

        // 4. TF-IDF 行列を構築
        const matrix = [];
        for (let i = 0; i < N; i++) {
            const rowVec = new Array(sortedVocab.length).fill(0);
            const words = docWordLists[i];
            const wordCounts = {};
            words.forEach(w => {
                if (vocabIndexMap.has(w)) {
                    wordCounts[w] = (wordCounts[w] || 0) + 1;
                }
            });

            let normSq = 0;
            Object.entries(wordCounts).forEach(([w, count]) => {
                const colIdx = vocabIndexMap.get(w);
                const tf = 1 + Math.log(count);
                const idf = Math.log(N / (docFreq[w] + 1)) + 1;
                const tfidf = tf * idf;
                rowVec[colIdx] = tfidf;
                normSq += tfidf * tfidf;
            });

            // L2正規化
            const norm = Math.sqrt(normSq);
            if (norm > 0) {
                for (let j = 0; j < rowVec.length; j++) {
                    rowVec[j] /= norm;
                }
            }

            matrix.push(rowVec);
        }

        return {
            vocabulary: sortedVocab,
            matrix,
            wordDocCounts: docFreq,
            docWordLists
        };
    },

    // ========================================================
    // ルール設定ファイル（text-analysis-test 互換）入出力パーサー
    // ========================================================

    /**
     * ルールテキストからセクション見出しを判定
     * @param {string} line 
     * @returns {'compound'|'stopword'|'synonym'|null}
     */
    isSectionHeader(line) {
        line = line.trim();
        if (!line) return null;

        const bracketMatch = line.match(/^[#\s■●▼*+\-]*[\[【](.+?)[\]】]/);
        if (bracketMatch) {
            const textInside = bracketMatch[1];
            if (/(?:複合語|まとめ語|結合語|compound)/i.test(textInside)) return 'compound';
            if (/(?:除外|ストップワード|不要語|stopword)/i.test(textInside)) return 'stopword';
            if (/(?:表記ゆれ|表記揺れ|置換|同義語|類義語|統一|synonym|replace)/i.test(textInside)) return 'synonym';
            return null;
        }

        const markerMatch = line.match(/^(?:#+|■|●|▼|\d+\.)\s*(.+)$/);
        if (markerMatch) {
            const afterMarker = markerMatch[1].trim();
            if (afterMarker.length <= 20 && !/(?:->|-->|=>|→|⇒)/.test(afterMarker)) {
                if (/^(?:複合語|まとめ語|結合語|compound words?)$/i.test(afterMarker) ||
                    /(?:複合語|まとめ語|結合語)/.test(afterMarker)) return 'compound';
                if (/(?:除外|ストップワード|不要語|stopwords?)/i.test(afterMarker)) return 'stopword';
                if (/(?:表記ゆれ|表記揺れ|置換|同義語|類義語|synonyms?)/i.test(afterMarker) ||
                    /(?:表記ゆれの統一|置換ルール)/.test(afterMarker)) return 'synonym';
            }
        }

        return null;
    },

    /**
     * テキスト形式の辞書設定をパース
     * @param {string} text 
     * @returns {{
     *   compoundWords: Set<string>,
     *   stopWords: Set<string>,
     *   synonymRules: Map<string, string>,
     *   unclassifiedWords: string[],
     *   hasExplicitSection: boolean
     * }}
     */
    parseRulesText(text) {
        const compoundWords = new Set();
        const stopWords = new Set();
        const synonymRules = new Map();
        const unclassifiedWords = [];
        let hasExplicitSection = false;

        if (!text) return { compoundWords, stopWords, synonymRules, unclassifiedWords, hasExplicitSection };

        text = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const lines = text.split('\n');
        let currentSection = null;

        for (let rawLine of lines) {
            let line = rawLine.trim();
            if (!line) continue;

            const section = this.isSectionHeader(line);
            if (section) {
                currentSection = section;
                hasExplicitSection = true;
                continue;
            }

            if (line.startsWith('#') || line.startsWith('//') || line.startsWith(';')) {
                continue;
            }

            const inlineCommentIdx = line.search(/\s+(?:#|\/\/)/);
            if (inlineCommentIdx !== -1) {
                line = line.substring(0, inlineCommentIdx).trim();
            }
            if (!line) continue;

            if (currentSection === 'compound') {
                compoundWords.add(line);
            } else if (currentSection === 'stopword') {
                stopWords.add(line);
            } else if (currentSection === 'synonym') {
                const sepMatch = line.match(/\s*(?:->|-->|=>|→|⇒|\t|,|，|：|:)\s*/);
                if (sepMatch) {
                    const fromWord = line.substring(0, sepMatch.index).trim();
                    const toWord = line.substring(sepMatch.index + sepMatch[0].length).trim();
                    if (fromWord && toWord) {
                        synonymRules.set(fromWord, toWord);
                    }
                }
            } else {
                const sepMatch = line.match(/\s*(?:->|-->|=>|→|⇒|\t)\s*/);
                if (sepMatch) {
                    const fromWord = line.substring(0, sepMatch.index).trim();
                    const toWord = line.substring(sepMatch.index + sepMatch[0].length).trim();
                    if (fromWord && toWord) {
                        synonymRules.set(fromWord, toWord);
                    }
                } else {
                    unclassifiedWords.push(line);
                }
            }
        }

        return { compoundWords, stopWords, synonymRules, unclassifiedWords, hasExplicitSection };
    },

    /**
     * 現在の辞書設定からエクスポート用テキストを生成
     * @param {Set<string>} compoundWordsSet 
     * @param {Set<string>} stopWordsSet 
     * @param {Map<string, string>} synonymRulesMap 
     * @returns {string}
     */
    generateRulesText(compoundWordsSet, stopWordsSet, synonymRulesMap) {
        const lines = [];
        lines.push("# ========================================================");
        lines.push("# アンケート自由記述 潜在トピック探索ツール - 辞書・ルール設定ファイル");
        lines.push("# （text-analysis-test 共通フォーマット）");
        lines.push("#");
        lines.push("# 【使い方】");
        lines.push("# ・このファイルはメモ帳などのテキストエディタで自由に編集できます。");
        lines.push("# ・行頭に「#」を付けるとその行はコメント（説明文）になります。");
        lines.push("# ・各セクション見出し（# [複合語] など）の下に設定したい単語を記述してください。");
        lines.push("# ========================================================");
        lines.push("");

        lines.push("# [複合語]");
        lines.push("# 形態素解析で分解されたくない単語を1行に1つずつ記述します。");
        lines.push("# （例: 「アフターサポート」が分割されずに1単語として扱われます）");
        if (compoundWordsSet && compoundWordsSet.size > 0) {
            const sortedCompounds = Array.from(compoundWordsSet).sort((a, b) => a.localeCompare(b, 'ja'));
            sortedCompounds.forEach(word => lines.push(word));
        } else {
            lines.push("# （登録されている複合語はありません）");
        }
        lines.push("");

        lines.push("# [除外ワード]");
        lines.push("# トピック分析の重要キーワードやパス図から除外したい不要語（ストップワード）を1行に1つずつ記述します。");
        if (stopWordsSet && stopWordsSet.size > 0) {
            const sortedStopWords = Array.from(stopWordsSet).sort((a, b) => a.localeCompare(b, 'ja'));
            sortedStopWords.forEach(word => lines.push(word));
        } else {
            lines.push("# （登録されている除外ワードはありません）");
        }
        lines.push("");

        lines.push("# [表記ゆれ]");
        lines.push("# 表記ゆれや同義語を統一するルールを「元の語 -> 統一後の語」の形式で記述します。");
        lines.push("# 矢印記号（-> や →）のほか、カンマ区切り（元の語,統一後の語）でも記述可能です。");
        if (synonymRulesMap && synonymRulesMap.size > 0) {
            const sortedSynonyms = Array.from(synonymRulesMap.entries()).sort((a, b) => a[0].localeCompare(b, 'ja'));
            sortedSynonyms.forEach(([from, to]) => lines.push(`${from} -> ${to}`));
        } else {
            lines.push("# （登録されている表記ゆれルールはありません）");
        }
        lines.push("");

        return lines.join("\n");
    }
};
