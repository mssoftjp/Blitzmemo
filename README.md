# Blitzmemo

話すだけで高速入力。Blitzmemo は OpenAI の次世代音声認識 AI を用いた、macOS / Windows 向けの音声による文字入力ソフトです。

- 公式サイト: https://blitzmemo.com/
- ダウンロード: https://blitzmemo.com/ja/#download
- 利用規約: https://blitzmemo.com/ja/terms.html
- プライバシーポリシー: https://blitzmemo.com/ja/privacy.html
- お問い合わせ: mailto:contact@ms-soft.jp

## インストール

配布物は ZIP 形式です（インストーラー不要）。

### macOS（Apple Silicon）

1. `Blitzmemo-darwin-arm64.zip` をダウンロード
2. 展開し、`Blitzmemo.app` を `/Applications` に移動（推奨）
3. 起動

補足:

- Gatekeeper によりブロックされることがあります。右クリック → **開く**、または **システム設定 → プライバシーとセキュリティ** から許可してください。

### Windows（x64）

1. `Blitzmemo-win32-x64.zip` をダウンロード
2. 展開し、フォルダごと移動（推奨: `C:\Users\[ユーザー名]\AppData\Local\Programs\Blitzmemo\` / 任意: `C:\Program Files\Blitzmemo\` ※要管理者権限）
3. フォルダ内の `Blitzmemo.exe` を起動

補足:

- SmartScreen の警告が出ることがあります。入手元を信頼できる場合は **詳細情報 → 実行** を選択してください。
- `AppData` は隠しフォルダです。見えない場合はエクスプローラーで「隠しファイル」を表示してください。

## 注意事項

- OpenAI API key が必要です（OpenAI 側の利用料が発生します）
- インターネット接続とマイク権限が必要です
- 音声/テキストは文字起こし・翻訳のため OpenAI API に送信されます
- Blitzmemo 以外のアプリケーションに入力する場合はクリップボードを使用します（macOS ではアクセシビリティ権限が必要です）

## License

Blitzmemo はプロプライエタリソフトウェアです。ソースコードは公開していません。

詳細: [LICENSE](LICENSE) / 第三者ライセンス: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

© Musashino Software. All rights reserved.

---

# Blitzmemo (English)

Type faster by speaking. Blitzmemo is voice-to-text software for macOS and Windows, powered by OpenAI’s next-generation speech recognition AI.

- Website: https://blitzmemo.com/
- Download: https://blitzmemo.com/en/#download
- Terms: https://blitzmemo.com/en/terms.html
- Privacy: https://blitzmemo.com/en/privacy.html
- Contact: mailto:contact@ms-soft.jp

## Install

Releases are distributed as ZIP files (no installer).

### macOS (Apple Silicon)

1. Download `Blitzmemo-darwin-arm64.zip`.
2. Unzip and move `Blitzmemo.app` to `/Applications` (recommended).
3. Launch the app.

Notes:

- If Gatekeeper blocks the app (unsigned/unnotarized), try right-click → **Open**, or allow it in **System Settings → Privacy & Security**.

### Windows (x64)

1. Download `Blitzmemo-win32-x64.zip`.
2. Unzip and move the extracted folder somewhere permanent (recommended: `C:\Users\<User>\AppData\Local\Programs\Blitzmemo\` / optional: `C:\Program Files\Blitzmemo\` (requires admin)).
3. Run `Blitzmemo.exe` in that folder.

Notes:

- Windows SmartScreen may warn for unsigned apps. If you trust the source, choose **More info → Run anyway**.
- `AppData` is a hidden folder. Enable “Hidden items” in File Explorer if you can’t see it.

## Notes

- An OpenAI API key is required (OpenAI usage costs apply)
- Internet connection and microphone permission are required
- Audio/text is sent to OpenAI for transcription/translation
- To type into other applications, Blitzmemo uses the clipboard (macOS requires Accessibility permission)

## License

Blitzmemo is proprietary software. Source code is not published.

Details: [LICENSE](LICENSE) / Third-party notices: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

© Musashino Software. All rights reserved.
