/**
 * CSV / テキストパーサーモジュール
 * CSV, TSVだけでなく、1行1回答のプレーンテキスト(.txt)にも柔軟に対応
 * UTF-8 (BOM付き含む) と Shift_JIS を自動判別してデコード
 */
const CsvParser = {
    /**
     * Fileまたは文字列をパースする
     * @param {File|Blob|string} input 
     * @returns {Promise<{headers: string[], rows: object[], fileName?: string}>}
     */
    async parse(input) {
        if (typeof input === 'string') {
            return this.parseTextContent(input, 'input.txt');
        }

        // input が File または Blob、またはファイルライクオブジェクトの場合
        const isFileLike = input && (
            (typeof File !== 'undefined' && input instanceof File) || 
            (typeof Blob !== 'undefined' && input instanceof Blob) || 
            (typeof input === 'object' && (typeof input.slice === 'function' || typeof input.arrayBuffer === 'function' || Boolean(input.name)))
        );

        if (isFileLike) {
            const fileName = input.name || 'uploaded_file';
            const lowerName = fileName.toLowerCase();
            const isExcel = lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls') || (input.type && input.type.includes('spreadsheet'));

            return new Promise((resolve, reject) => {
                const reader = new FileReader();

                reader.onload = (e) => {
                    try {
                        const buffer = e.target.result;
                        if (isExcel) {
                            const result = this.parseExcelBuffer(buffer, fileName);
                            resolve(result);
                        } else {
                            // テキスト（CSV, TSV, TXT）
                            let text = '';
                            try {
                                const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
                                text = utf8Decoder.decode(buffer);
                            } catch (err) {
                                try {
                                    const sjisDecoder = new TextDecoder('shift-jis');
                                    text = sjisDecoder.decode(buffer);
                                } catch (sjisErr) {
                                    // どちらも失敗した場合は非厳密UTF-8でフォールバック
                                    const fallbackDecoder = new TextDecoder('utf-8', { fatal: false });
                                    text = fallbackDecoder.decode(buffer);
                                }
                            }
                            text = text.replace(/^\uFEFF/, '');
                            const result = this.parseTextContent(text, fileName);
                            resolve(result);
                        }
                    } catch (parseErr) {
                        reject(parseErr);
                    }
                };

                reader.onerror = () => {
                    reject(new Error('ファイルの読み取りに失敗しました (FileReaderエラー)'));
                };

                reader.readAsArrayBuffer(input);
            });
        }

        throw new Error('サポートされていない入力形式です');
    },

    /**
     * Excelファイル (.xlsx, .xls) のバイナリバッファをパース
     * @param {ArrayBuffer} buffer 
     * @param {string} fileName 
     * @returns {{headers: string[], rows: object[], fileName: string}}
     */
    parseExcelBuffer(buffer, fileName = '') {
        if (typeof XLSX === 'undefined') {
            throw new Error('Excel解析ライブラリ (XLSX) が読み込まれていません。画面を再読み込みしてください。');
        }

        const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
            throw new Error('Excelファイル内にシートが見つかりませんでした');
        }

        // シートの自動選択（データ行数が最も多いシートを優先、または第1シート）
        let bestSheetName = workbook.SheetNames[0];
        let maxDataLength = 0;
        let bestData = null;

        for (const sheetName of workbook.SheetNames) {
            const ws = workbook.Sheets[sheetName];
            const rawData = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false });
            if (rawData && rawData.length > maxDataLength) {
                maxDataLength = rawData.length;
                bestSheetName = sheetName;
                bestData = rawData;
            }
        }

        if (!bestData || bestData.length === 0) {
            throw new Error('Excelシート内にデータが見つかりませんでした');
        }

        // 先頭の有効な行を探す（ヘッダー行）
        let headerRowIdx = 0;
        while (headerRowIdx < bestData.length && (!bestData[headerRowIdx] || bestData[headerRowIdx].every(c => String(c).trim() === ''))) {
            headerRowIdx++;
        }

        if (headerRowIdx >= bestData.length) {
            throw new Error('Excelシート内に有効な行が見つかりませんでした');
        }

        const rawHeaderRow = bestData[headerRowIdx];

        // 1列のみでヘッダーが長い場合、プレーンテキスト形式として処理
        const nonEmptyCells = rawHeaderRow.filter(c => String(c).trim() !== '');
        if (nonEmptyCells.length === 1 && String(nonEmptyCells[0]).length > 25) {
            const lines = [];
            for (let r = headerRowIdx; r < bestData.length; r++) {
                const cell = bestData[r] && bestData[r][0] !== undefined ? String(bestData[r][0]).trim() : '';
                if (cell.length > 0) lines.push(cell);
            }
            return this.parsePlainText(lines);
        }

        const headerRow = rawHeaderRow.map((c, i) => {
            const str = String(c !== undefined && c !== null ? c : '').trim();
            return str.length > 0 ? str : `列${i + 1}`;
        });

        // 列名の重複解消
        const headerCounts = {};
        const headers = headerRow.map(h => {
            if (!headerCounts[h]) {
                headerCounts[h] = 1;
                return h;
            } else {
                headerCounts[h]++;
                return `${h}_${headerCounts[h]}`;
            }
        });

        const rows = [];
        for (let r = headerRowIdx + 1; r < bestData.length; r++) {
            const rowArr = bestData[r];
            if (!rowArr || rowArr.every(c => String(c).trim() === '')) continue;
            const rowObj = {};
            headers.forEach((h, cIdx) => {
                const val = rowArr[cIdx] !== undefined && rowArr[cIdx] !== null ? String(rowArr[cIdx]).trim() : '';
                rowObj[h] = val;
            });
            rows.push(rowObj);
        }

        if (rows.length === 0) {
            throw new Error('有効なデータ行が見つかりませんでした');
        }

        return {
            headers,
            rows,
            fileName: fileName || `${bestSheetName}.xlsx`
        };
    },

    /**
     * テキスト内容を判定してパース
     * @param {string} text 
     * @param {string} fileName 
     * @returns {{headers: string[], rows: object[]}}
     */
    parseTextContent(text, fileName = '') {
        const cleanText = text.replace(/^\uFEFF/, '').trim();
        const lowerName = fileName.toLowerCase();
        const isTxtFile = lowerName.endsWith('.txt');

        // 改行で行分割してサンプリング
        const rawLines = cleanText.split(/\r?\n/).filter(line => line.trim().length > 0);
        if (rawLines.length === 0) {
            throw new Error('ファイル内に有効なテキストが見つかりませんでした');
        }

        // CSV/TSV判定: 複数行をチェックしてカンマまたはタブが規則的に含まれているか
        const sampleLines = rawLines.slice(0, Math.min(20, rawLines.length));
        const commaCounts = sampleLines.map(l => (l.match(/,/g) || []).length);
        const tabCounts = sampleLines.map(l => (l.match(/\t/g) || []).length);

        const hasConsistentCommas = commaCounts.length > 1 && commaCounts[0] >= 1 && commaCounts.every(c => c === commaCounts[0]);
        const hasConsistentTabs = tabCounts.length > 1 && tabCounts[0] >= 1 && tabCounts.every(c => c === tabCounts[0]);

        // .txt でカンマ/タブが一定でなければ「1行1回答のプレーンテキスト」として処理
        if (isTxtFile && !hasConsistentCommas && !hasConsistentTabs) {
            return this.parsePlainText(rawLines);
        }

        // CSV/TSVの場合、PapaParseで解析
        const parsed = Papa.parse(cleanText, {
            header: true,
            skipEmptyLines: 'greedy',
            dynamicTyping: false
        });

        // もしPapaParseで列が1列しかなく、かつヘッダー名が長すぎる場合はテキストファイルとみなす
        const fields = (parsed.meta.fields || []).map(f => f.replace(/^\uFEFF/, '').trim());
        if (fields.length === 1 && fields[0].length > 25) {
            return this.parsePlainText(rawLines);
        }

        if (fields.length > 0 && parsed.data.length > 0) {
            // フィールド名のBOMを除去してキーを正規化
            const sanitizedRows = parsed.data.map(row => {
                const newRow = {};
                fields.forEach(f => {
                    newRow[f] = row[f] || row['\uFEFF' + f] || '';
                });
                return newRow;
            }).filter(r => Object.values(r).some(v => v !== null && String(v).trim() !== ''));

            return {
                headers: fields,
                rows: sanitizedRows
            };
        }

        // フォールバック: プレーンテキストとして処理
        return this.parsePlainText(rawLines);
    },

    /**
     * 1行1回答のテキスト（watcher.txtのようなファイル）をパースする
     * @param {string[]} lines 
     * @returns {{headers: string[], rows: object[]}}
     */
    parsePlainText(lines) {
        if (lines.length === 0) {
            return { headers: ['自由記述テキスト'], rows: [] };
        }

        const firstLine = lines[0].trim();
        let headerName = '自由記述テキスト';
        let startIndex = 0;

        // 1行目が短いキーワード（見出し/ラベル）っぽい場合、それをヘッダー名にする
        // 例: 「理由」「ご意見」「回答」「アンケート」「自由記述」「text」など
        const isHeaderLike = firstLine.length <= 15 && !/[。、！？]$/.test(firstLine);
        if (isHeaderLike) {
            headerName = firstLine;
            startIndex = 1;
        }

        const rows = [];
        for (let i = startIndex; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.length > 0) {
                const rowObj = { ID: i + (startIndex === 1 ? 0 : 1) };
                rowObj[headerName] = line;
                rows.push(rowObj);
            }
        }

        return {
            headers: ['ID', headerName],
            rows: rows
        };
    },

    /**
     * Excel等からコピー＆ペーストされたテキストをパースする
     * @param {string} text 
     * @param {object} [options]
     * @param {boolean} [options.hasHeader=true] 1行目を列名として扱うか
     * @returns {{headers: string[], rows: object[]}}
     */
    parsePastedText(text, options = {}) {
        const hasHeader = (options.hasHeader !== undefined) ? options.hasHeader : true;
        const cleanText = String(text || '').replace(/^\uFEFF/, '').trim();
        if (!cleanText) {
            throw new Error('貼り付けられたテキストが空です');
        }

        const lines = cleanText.split(/\r?\n/).filter(line => line.trim().length > 0);
        if (lines.length === 0) {
            throw new Error('有効なデータ行が見つかりませんでした');
        }

        // 区切り文字判定（タブまたはカンマ）
        const sampleLines = lines.slice(0, Math.min(10, lines.length));
        const tabCounts = sampleLines.map(l => (l.match(/\t/g) || []).length);
        const commaCounts = sampleLines.map(l => (l.match(/,/g) || []).length);

        const hasTabs = tabCounts.some(c => c > 0);
        const hasCommas = commaCounts.some(c => c > 0);

        // 1列のみ（タブもカンマも含まれない）の場合
        if (!hasTabs && !hasCommas) {
            if (hasHeader && lines.length > 1) {
                const firstLine = lines[0].trim();
                const isShortHeader = firstLine.length <= 20 && !/[。、！？]$/.test(firstLine);
                if (isShortHeader) {
                    return this.parsePlainText(lines);
                }
            }
            // 全行をデータ行として取り込む（1列形式）
            const rows = lines.map((l, idx) => ({
                ID: idx + 1,
                '自由記述テキスト': l.trim()
            }));
            return {
                headers: ['ID', '自由記述テキスト'],
                rows: rows
            };
        }

        // 複数列（TSVまたはCSV）の場合
        if (!hasHeader) {
            // ヘッダーなしモード: 全行をデータとしてパースし、列名を自動生成
            const parsed = Papa.parse(cleanText, {
                header: false,
                skipEmptyLines: 'greedy',
                dynamicTyping: false
            });

            if (!parsed.data || parsed.data.length === 0) {
                throw new Error('データのパースに失敗しました');
            }

            const colCount = Math.max(...parsed.data.map(row => row.length));
            const headers = [];
            for (let i = 1; i <= colCount; i++) {
                headers.push(`列${i}`);
            }

            const rows = parsed.data.map((row) => {
                const rowObj = {};
                headers.forEach((h, cIdx) => {
                    rowObj[h] = row[cIdx] !== undefined ? String(row[cIdx]).trim() : '';
                });
                return rowObj;
            }).filter(r => Object.values(r).some(v => v !== ''));

            return { headers, rows };
        } else {
            // ヘッダーありモード
            const parsed = Papa.parse(cleanText, {
                header: true,
                skipEmptyLines: 'greedy',
                dynamicTyping: false
            });

            const fields = (parsed.meta.fields || []).map(f => f.replace(/^\uFEFF/, '').trim());
            if (fields.length > 0 && parsed.data.length > 0) {
                const sanitizedRows = parsed.data.map(row => {
                    const newRow = {};
                    fields.forEach(f => {
                        const val = row[f] || row['\uFEFF' + f] || '';
                        newRow[f] = (val !== undefined && val !== null) ? String(val).trim() : '';
                    });
                    return newRow;
                }).filter(r => Object.values(r).some(v => v !== ''));

                return {
                    headers: fields,
                    rows: sanitizedRows
                };
            }

            // フォールバック
            return this.parsePlainText(lines);
        }
    },

    /**
     * 自由記述・発言テキスト列を高精度に自動推測する
     * ヘッダー名の意味解析（ポジティブ/ネガティブ判定）と、
     * セルの内容分析（有効値の平均長、最大長、文構造・句読点、ユニーク性・多様性、数値/URL除外）を統合
     * @param {string[]} headers 
     * @param {object[]} rows 
     * @returns {string|null}
     */
    guessTextColumn(headers, rows) {
        if (!headers || headers.length === 0) return null;
        if (!rows || rows.length === 0) return headers[0];

        // 調査サンプリング行数（最大100行）
        const sampleRows = rows.slice(0, 100);
        let bestCol = null;
        let bestScore = -Infinity;

        headers.forEach(h => {
            const trimmedH = h.trim();
            const lowerH = trimmedH.toLowerCase();

            let score = 0;

            // 1. ヘッダー名のネガティブ判定（ID、日時、メタデータ列など）
            const isNegativeHeader = (
                /^(id|no|番号|連番|コード|code)$/i.test(trimmedH) ||
                /(回答者id|回答者番号|回答id|ユーザーid|user_?id|member_?id|session_?id)/i.test(lowerH) ||
                /(日時|日付|時間|タイムスタンプ|timestamp|date|time|created_?at|updated_?at)/i.test(lowerH) ||
                /(回答日|回答時刻|回答日時|回答ステータス|回答フラグ|回答状況|回答完了)/i.test(lowerH) ||
                /(メール|mail|email|電話|tel|ipアドレス|ip_?address|ユーザーエージェント|user_?agent)/i.test(lowerH) ||
                /^(url|link|リンク)$/i.test(lowerH)
            );

            if (isNegativeHeader) {
                score -= 400;
            }

            // 2. ヘッダー名のポジティブ判定
            // (A) 最上位キーワード（自由記述・生の声そのものを指す言葉）
            if (/(自由記述|自由回答|発言内容|発言|ご意見|意見|コメント|要望|不満|感想|本文|所感|フィードバック|生の声|相談内容)/i.test(lowerH) ||
                /(feedback|comment|comments|opinion|free_?text|open_?ended|verbatim|voice)/i.test(lowerH)) {
                score += 180;
            }
            // (B) 次点キーワード（理由、詳細、内容、テキスト、メモ、備考など）
            else if (/(理由|詳細|内容|テキスト|text|メモ|備考|相談|質問|説明|記述|所見)/i.test(lowerH) ||
                     /(detail|description|reason|note|notes)/i.test(lowerH)) {
                score += 70;
            }
            // (C) 「回答」キーワード（ネガティブ判定を受けていない場合のみ加点）
            else if (!isNegativeHeader && /(回答|answer)/i.test(lowerH)) {
                score += 50;
            }

            // 3. セルデータ（内容）の統計的特徴の分析
            let validCount = 0;
            let totalLen = 0;
            let maxLen = 0;
            let punctuationCount = 0;
            let numericCount = 0;
            let urlCount = 0;
            let dateCount = 0;
            const uniqueValues = new Set();

            sampleRows.forEach(r => {
                const val = r[h];
                if (val !== undefined && val !== null) {
                    const str = String(val).trim();
                    if (str.length > 0) {
                        validCount++;
                        totalLen += str.length;
                        if (str.length > maxLen) maxLen = str.length;
                        uniqueValues.add(str);

                        // 日本語の文末・句読点・改行（自由記述文の強い指標）
                        if (/[。、！？!?\n]/.test(str)) {
                            punctuationCount++;
                        }
                        // 数値判定
                        if (!isNaN(Number(str)) && !/^\s*$/.test(str)) {
                            numericCount++;
                        }
                        // URL判定
                        if (/^https?:\/\//i.test(str)) {
                            urlCount++;
                        }
                        // 日付判定（2026-10-25, 2026/10/25 など）
                        if (/^\d{4}[-/年]\d{1,2}[-/月]\d{1,2}/.test(str)) {
                            dateCount++;
                        }
                    }
                }
            });

            if (validCount === 0) {
                // 有効データがゼロの列は大幅減点
                score -= 500;
            } else {
                const avgLen = totalLen / validCount;
                const uniqueRatio = uniqueValues.size / validCount;
                const punctRatio = punctuationCount / validCount;

                // (A) 平均文字数による加点（空欄を除外した実質平均）
                if (avgLen >= 50) {
                    score += 120 + Math.min(80, (avgLen - 50) * 1.0);
                } else if (avgLen >= 20) {
                    score += 60 + (avgLen - 20) * 2.0;
                } else if (avgLen >= 8) {
                    score += (avgLen - 8) * 4.0;
                } else {
                    // 8文字未満は選択肢やコードの可能性が高い
                    score -= 40;
                }

                // (B) 最大文字数（1人でもしっかり書いている人がいれば自由記述の可能性大）
                if (maxLen >= 100) {
                    score += 60;
                } else if (maxLen >= 50) {
                    score += 30;
                }

                // (C) 文構造（句読点や改行）の存在割合
                if (punctRatio >= 0.3) {
                    score += 80;
                } else if (punctRatio >= 0.1) {
                    score += 40;
                }

                // (D) 多様性・ユニーク性（選択肢列は同じ文字列が繰り返されるが、自由記述はほぼ全て異なる）
                if (uniqueRatio >= 0.7 && validCount >= 5) {
                    score += 60;
                } else if (uniqueRatio < 0.25 && uniqueValues.size <= 8 && validCount >= 10) {
                    // ユニーク値が数個しかない列はほぼ確実に「選択肢・属性」列
                    score -= 150;
                }

                // (E) 数値・URL・日付のペナルティ
                if (numericCount / validCount >= 0.7) {
                    score -= 300;
                }
                if (urlCount / validCount >= 0.5) {
                    score -= 250;
                }
                if (dateCount / validCount >= 0.7) {
                    score -= 300;
                }
            }

            if (score > bestScore) {
                bestScore = score;
                bestCol = h;
            }
        });

        return bestCol || headers[0];
    },

    /**
     * 最適な属性列（クロス集計用の属性・立場・年代など）を1つ推測する
     * @param {string[]} headers 
     * @param {object[]} rows 
     * @param {string} textCol 
     * @returns {string}
     */
    guessAttributeColumn(headers, rows, textCol) {
        if (!headers || headers.length === 0) return '';
        const sampleRows = (rows || []).slice(0, 100);

        // 強い属性キーワード（日本語・英語）
        const attrKeywords = [
            '発言者', '出席者', '参加者', '話者', '立場', '役職', '所属', '区分', '属性',
            '年代', '年齢', '性別', 'カテゴリ', '満足度', '地域', '部門', '部署', 'グループ',
            '職業', 'プラン', 'クラス', '学年', '形態', '種別', '会員',
            'role', 'speaker', 'user_type', 'type', 'status', 'category', 'segment', 'gender', 'age', 'department'
        ];

        let bestCol = '';
        let bestScore = -Infinity;

        headers.forEach(h => {
            if (h === textCol) return;
            const trimmedH = h.trim();
            const lowerH = trimmedH.toLowerCase();

            // ID列や日時は除外
            if (/^(id|no|番号|連番|コード|code)$/i.test(trimmedH) ||
                /(日時|日付|時間|タイムスタンプ|timestamp|date|time|created|updated)/i.test(lowerH) ||
                /^(url|link|メール|mail|email|tel)$/i.test(lowerH)) {
                return;
            }

            let score = 0;
            if (attrKeywords.some(k => lowerH.includes(k))) {
                score += 100;
            }

            // ユニーク値の個数と中身をチェック
            const values = new Set();
            let validCount = 0;
            let dateCount = 0;
            sampleRows.forEach(r => {
                const val = r[h];
                if (val !== undefined && val !== null && String(val).trim() !== '') {
                    const str = String(val).trim();
                    values.add(str);
                    validCount++;
                    if (/^\d{4}[-/年]\d{1,2}[-/月]\d{1,2}/.test(str)) {
                        dateCount++;
                    }
                }
            });

            if (validCount === 0 || dateCount / (validCount || 1) >= 0.7) {
                return;
            }

            if (values.size >= 2 && values.size <= 25) {
                score += 50;
                // 全行ユニークでなく、ある程度同じカテゴリにまとまっているか
                if (validCount >= 10 && values.size <= validCount * 0.6) {
                    score += 30;
                }
            } else if (values.size > 25 || values.size <= 1) {
                score -= 60;
            }

            if (score > bestScore) {
                bestScore = score;
                bestCol = h;
            }
        });

        return bestScore > 0 ? bestCol : '';
    },

    /**
     * 属性列（年代、性別、満足度など、ユニーク値が2〜15個程度の列）の候補を探す
     * @param {string[]} headers 
     * @param {object[]} rows 
     * @param {string} textCol 
     * @returns {string[]}
     */
    guessAttributeColumns(headers, rows, textCol) {
        if (!headers || rows.length === 0) return [];

        return headers.filter(h => {
            if (h === textCol) return false;
            if (/^id$|^no$|^番号$/i.test(h.trim())) return false;

            const values = new Set();
            rows.forEach(r => {
                const val = r[h];
                if (val !== undefined && val !== null && String(val).trim() !== '') {
                    values.add(String(val).trim());
                }
            });

            return values.size >= 2 && values.size <= Math.min(25, Math.ceil(rows.length * 0.6));
        });
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CsvParser;
}
