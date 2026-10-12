#!/bin/bash
# アンケート・キーワード連想＆意見深掘りツール 起動スクリプト
PORT=8080
echo "Starting Survey Focus Explorer on http://localhost:$PORT ..."

# 既存のポート使用チェック
if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null ; then
    PORT=8081
fi

if command -v python3 &>/dev/null; then
    python3 -m http.server $PORT &
elif command -v python &>/dev/null; then
    python -m SimpleHTTPServer $PORT &
else
    echo "Python is not installed. Please open index.html directly."
    exit 1
fi

SERVER_PID=$!
sleep 1

# ブラウザ起動
if command -v xdg-open &>/dev/null; then
    xdg-open "http://localhost:$PORT"
elif command -v google-chrome &>/dev/null; then
    google-chrome "http://localhost:$PORT"
fi

echo "Press Ctrl+C to stop the server."
wait $SERVER_PID
