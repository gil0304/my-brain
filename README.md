# MY BRAIN

ぎるの頭の中を 3D 空間で可視化するインタラクティブアート (Nuxt 4 + Three.js + GSAP)。

必要な Node.js: 22.22.3 以上 または 24.15 以上 (`.nvmrc` は 24)

```bash
nvm install    # .nvmrc の Node 24 を入れる (初回だけ)
nvm use
npm install
npm run dev        # http://localhost:3000
npm run generate   # 静的サイトを .output/public に出力
```

GitHub Pages のサブパス (例: `https://gil0304.github.io/my-brain/`) に置く場合:

```bash
NUXT_APP_BASE_URL=/my-brain/ npm run generate
```

## 中身の編集

`data/brain.ts` だけを書き換えれば OK。

- `profile.name` … 脳の真ん中に出る名前
- `brainData` … カテゴリー(色・脳内の場所)と、その周りに浮かぶワード
  - ワードは `'バスケ'` のような文字列でも、`{ label: 'ものづくり', words: [...] }` のような入れ子でも書ける
  - `{ label: 'QR', qr: 'https://...' }` と書くと、ワードの代わりに QR コードが浮かぶ
- `brainLinks` … カテゴリーをまたぐつながり (弧の線になる)
- `featuredWork` … 脳内の「QR」が指す作品

## 操作

| 操作 | 挙動 |
| --- | --- |
| ドラッグ / スワイプ | 回転 |
| スクロール / ピンチ | 拡大・縮小 |
| ホバー | ノードと関連線を強調 |
| クリック / タップ | そのノードに近づき、つながりを強調 |
| 背景をクリック / Esc | 強調を解除 |
| ダブルクリック / ダブルタップ | 全体表示に戻す |
| `S` / `Shift + S` | SNS 用 PNG を保存 (1080×1350 / 1080×1080)。すべてのワードと読み取れる大きさの QR が入るアングルを自動で選ぶ |
