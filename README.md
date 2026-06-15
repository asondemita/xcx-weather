# 天気予報 (Weather Forecast)

[Xcratch](https://xcratch.github.io/) 用の天気予報拡張機能です。

郵便番号を指定するだけで、天気予報の値を返すレポーターブロックを追加します。

- **時間別予報**（n時間後）… 天気・気温・降水確率・風速・風向き・WBGT（暑さ指数）
- **週間予報**（最大7日先）… 天気・最高気温・最低気温・降水確率・日の出・日の入り
- **地名** … 郵便番号が解決された地名（日本語）

天気データは無料の [Open-Meteo](https://open-meteo.com/) API、郵便番号→緯度経度の変換は [Zippopotam.us](https://www.zippopotam.us/) を利用しています（APIキー不要・インターネット接続が必要です）。

---

## ✨ この拡張でできること

サンプルプロジェクトを開くと、この「天気予報」拡張で何ができるかを試せます。

▶ [サンプルプロジェクトを開く](https://xcratch.github.io/editor/#https://asondemita.github.io/xcx-weather/projects/example.sb3)

<iframe src="https://xcratch.github.io/editor/player#https://asondemita.github.io/xcx-weather/projects/example.sb3" width="540px" height="460px"></iframe>

---

## ブロック一覧

| ブロック | 説明 |
|---|---|
| `郵便番号 [100-0001] 付近の [1時間後▼] の (天気▼)` | 指定した郵便番号付近の、現在からn時間後の予報値を返します |
| `郵便番号 [100-0001] 付近の [明日▼] の (天気▼)` | 指定した郵便番号付近の、週間予報（最大7日先）の値を返します |
| `郵便番号 [100-0001] の地名` | その郵便番号が解決された地名（日本語）を返します |

> ℹ️ **「付近」の意味（予報地点について）**
>
> このブロックが返すのは「郵便番号ピンポイントの天気」ではなく、「**その郵便番号付近（数km四方のエリア）の予報**」です。内部では次の2段階の近似が入ります。
>
> 1. 郵便番号 → そのエリアの**代表点1つ**（[Zippopotam.us](https://www.zippopotam.us/) による緯度経度変換）
> 2. その代表点 → 気象モデルの**最寄り格子点**（[Open-Meteo](https://open-meteo.com/) が数km四方のセルにスナップ）
>
> どの地点に解決されたかは `郵便番号 [ZIP] の地名` ブロックで確認できます（日本語表記、例: `東京都千代田区`）。これは郵便番号→緯度経度の変換のあと、[Open-Meteo Geocoding API](https://open-meteo.com/en/docs/geocoding-api) で日本語の地名へ変換したものです。厳密な1点の天気ではない点にご注意ください。

### 時間別予報ブロック

`郵便番号 [ZIP] 付近の [n時間後▼] の [項目▼]` は、現在からn時間後の予報値を返します。

選べる項目（表示順）:

| 項目 | 内容 |
|---|---|
| 天気 | 日本語の天気（快晴 / 晴れ / 曇り / 雨 / 雪 / 雷雨 など。WMO天気コードを日本語化） |
| 気温 | 摂氏（℃） |
| 降水確率 | パーセント（%） |
| 風速 | メートル毎秒（m/s） |
| 風向き | 16方位の日本語（北 / 北北東 / 北東 … 風が吹いてくる方向） |
| WBGT(暑さ指数) | 摂氏（℃）の推定値（[後述](#wbgt暑さ指数について)） |
| WBGT(危険度ラベル) | ほぼ安全 / 注意 / 警戒 / 厳重警戒 / 危険 のいずれか（[後述](#wbgt暑さ指数について)） |

「n時間後」はプルダウンから **今 / 1 / 2 / 3 / 6 / 12 / 24 / 48時間後** を選びます。毎正時のデータに最も近い値を返すため、最大±30分程度のずれがあります。郵便番号が見つからない・通信に失敗した場合は空の値を返します。

郵便番号は **半角・全角どちらの数字でも、ハイフンの有無も問わず**入力できます（例: `100-0001` / `1000001` / `１０００００１` / `１００－０００１`）。7桁の数字として認識できない入力は空の値を返します。

### 週間予報ブロック

`郵便番号 [ZIP] 付近の [日▼] の [項目▼]` は、日単位（週間）の予報値を返します。

- **日** … プルダウンから **今日 / 明日 / 明後日 / 3日後 / 4日後 / 5日後 / 6日後**（最大7日先）を選択
- **項目** … 次から選択

| 項目 | 内容 |
|---|---|
| 天気 | その日の代表的な天気（日本語） |
| 最高気温 | 摂氏（℃） |
| 最低気温 | 摂氏（℃） |
| 降水確率 | その日の最大降水確率（%） |
| 日の出 | 時刻（HH:MM） |
| 日の入り | 時刻（HH:MM） |

時間別ブロックとは別系統の、Open-Meteo の日別データ（`temperature_2m_max` / `temperature_2m_min` / `precipitation_probability_max` / `weather_code` / `sunrise` / `sunset`）を利用しています。

---

## WBGT（暑さ指数）について

WBGT（湿球黒球温度＝暑さ指数）は、気温・湿度・日射・風速から熱中症のリスクを表す指標です。本拡張では Open-Meteo の予報値（気温・相対湿度・日射量・風速）から、**小野ら（2014）の屋外WBGT推定回帰式**を用いて計算しています。これは環境省が暑さ指数の実況・予測の算出に用いているのと同じ式です。

```
WBGT = 0.735×Ta + 0.0374×RH + 0.00292×Ta×RH
       + 7.619×SR − 4.557×SR² − 0.0572×WS − 4.064
```

| 記号 | 意味 | 元データ（Open-Meteo） |
|---|---|---|
| Ta | 気温（℃） | `temperature_2m` |
| RH | 相対湿度（%） | `relative_humidity_2m` |
| SR | 全天日射量（kW/m²） | `shortwave_radiation`（W/m² を 1/1000 換算） |
| WS | 風速（m/s） | `wind_speed_10m` |

危険度ラベルは、日本生気象学会「日常生活における熱中症予防指針」の区分に従います。

| WBGT（℃） | ラベル |
|---|---|
| 21 未満 | ほぼ安全 |
| 21 以上 25 未満 | 注意 |
| 25 以上 28 未満 | 警戒 |
| 28 以上 31 未満 | 厳重警戒 |
| 31 以上 | 危険 |

### 熱中症アラートを作るには

プログラムで「熱中症アラート」を出したい場合は、**WBGT が 28 以上（＝「厳重警戒」以上）かどうか**で判定するのがおすすめです。環境省・日本生気象学会の指針でも、WBGT 28℃以上は熱中症の危険が高まり「激しい運動は中止」が推奨される目安とされています。

例（擬似コード）:

```
もし ( 郵便番号 [100-0001] 付近の [今] の (WBGT(暑さ指数)) ≥ 28 ) なら
    「熱中症に警戒！」と言う
```

より厳しめにしたい場合は 31 以上（「危険」）で判定します。

> ⚠️ **重要 — この値は推定値です**
>
> 本拡張のWBGTは「屋外・日向」を前提とした**推定値**であり、環境省が公表する公式の暑さ指数（WBGT）そのものではありません。計算式は同じでも、入力に用いる気象データの出どころが環境省（気象庁の数値予報など）とは異なるため、公式値とは一致しません。また日射量予報の精度に影響されます。**運動・作業の可否や熱中症対策などの最終判断は、必ず[環境省 熱中症予防情報サイト](https://www.wbgt.env.go.jp/)の公式値を参照してください。**

---

## Xcratch での使い方

この拡張は、[Xcratch](https://xcratch.github.io/) 上で他の拡張と組み合わせて使えます。

1. [Xcratch エディタ](https://xcratch.github.io/editor) を開く
2. 「拡張機能を追加」ボタンをクリック
3. 「Extension Loader」拡張を選ぶ
4. 入力欄に次のモジュールURLを入力する

   ```
   https://asondemita.github.io/xcx-weather/dist/weatherForecast.mjs
   ```

5. 「OK」ボタンをクリック
6. これでこの拡張のブロックが使えるようになります

---

## 開発

### 依存パッケージのインストール

```sh
npm install
```

### 開発環境のセットアップ

`./scripts/setup-dev.js` 内の `vmSrcOrg` を、ローカルの `scratch-vm` ディレクトリに合わせて変更してから、セットアップスクリプトを実行します。

```sh
npm run setup-dev
```

### APM による xcratch-skills のインストール

[APM (Agent Package Manager)](https://github.com/microsoft/apm) をインストールし、次を実行します。

```sh
apm install --target copilot
```

これで各エージェントクライアントにスキルが自動設定されます。インストール後は、次のような自然言語のトリガーフレーズが使えます。

| トリガーフレーズ | 呼び出されるスキル |
|---|---|
| `xcratch-create`, `scaffold extension` | `xcratch-extension-create` — 新しい拡張リポジトリを生成し、開発環境をセットアップ |
| `breakpoints not hit`, `debug on dev-server` | `xcratch-extension-debug` — ソースマップやローカルHTTPSの問題を修正 |
| `verify extension loads`, `check console errors` | `xcratch-extension-debug-auto` — エディタへ自動で移動し、読み込まれた拡張を検査 |
| `add to stretch3`, `stretch3-install` | `xcratch-extension-stretch3` — stretch3 用のインストールスクリプトとエントリファイルを生成 |

### モジュールへのバンドル

ビルドスクリプトを実行すると、この拡張を Xcratch で読み込めるモジュールファイルにバンドルします。

```sh
npm run build
```

### 変更を監視して自動ビルド

監視スクリプトを実行すると、ソースファイルの変更を検知して自動でバンドルします。

```sh
npm run watch
```

### テスト

テストスクリプトを実行して、この拡張をテストします。

```sh
npm run test
```

### バージョン管理とデプロイ

このプロジェクトでは、npm version コマンドと GitHub Actions を使ってバージョン管理とデプロイを行います。

#### 新しいバージョンを作成する

npm version コマンドでバージョン番号を更新します。これにより、次が自動で行われます。

1. `package.json` のバージョン更新
2. ビルドスクリプトの実行
3. バージョン別ビルドファイル（`dist/{version}/`）の作成
4. `dist/versions.json` への新バージョン情報の追記
5. git のコミットとタグの作成

```sh
# パッチ版 (1.3.0 → 1.3.1)
npm version patch

# マイナー版 (1.3.1 → 1.4.0)
npm version minor

# メジャー版 (1.4.0 → 2.0.0)
npm version major
```

#### GitHub Pages へのデプロイ

新しいバージョンを作成したら、タグをプッシュすると自動デプロイがトリガーされます。

```sh
# バージョンタグをプッシュ
git push origin v1.4.0

# またはすべてのタグをプッシュ
git push --tags
```

GitHub Actions のワークフローが次を実行します。

1. 拡張のビルド
2. `dist/`・`projects/`・`README.md` を GitHub Pages へデプロイ

GitHub の Actions タブから手動でデプロイをトリガーすることもできます。

#### バージョン情報

すべてのビルドバージョンは `dist/versions.json` に記録されます。

```json
{
  "extensionId": "weatherForecast",
  "latest": "1.0.0",
  "versions": [
    {
      "version": "1.0.0",
      "buildDate": "2025-10-19T12:34:56.789Z",
      "module": "1.0.0/weatherForecast.mjs"
    }
  ]
}
```

---

## クレジット / ライセンス

本拡張は、**無料・非商用の教育目的**で提供する個人プロジェクトです。

### 利用データと帰属表示

- **天気・ジオコーディング**: [Open-Meteo](https://open-meteo.com/) — データは [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/) で提供されています。
- **郵便番号→緯度経度**: [Zippopotam.us](https://www.zippopotam.us/) — データ元は [GeoNames](https://www.geonames.org/)（[CC-BY](https://creativecommons.org/licenses/by/4.0/)）。
- **WBGT（暑さ指数）の計算式**: 小野ら（2014）の屋外WBGT推定回帰式（環境省採用）。

### 利用上の注意

- **非商用利用について**: Open-Meteo の無料APIは**非商用利用に限られます**。本拡張を商用の製品・サービスに組み込むなど商用目的で利用する場合は、各自で [Open-Meteo の商用プラン](https://open-meteo.com/en/pricing) の契約が必要です。
- **レート制限**: Open-Meteo の無料枠は 1日10,000・1時間5,000・1分600リクエストです（IP単位）。学校など多数の端末が**同一のグローバルIP**を共有する環境では、合算で上限に達する場合があります。
- データはいずれも無保証です。特にWBGTは推定値のため、熱中症対策などの最終判断は[環境省の公式値](https://www.wbgt.env.go.jp/)を参照してください。

### コードのライセンス

本拡張のソースコードは [MIT License](./LICENSE) です。

## 🏠 ホームページ

このページは [https://asondemita.github.io/xcx-weather/](https://asondemita.github.io/xcx-weather/) から開けます。

## 🤝 コントリビュート

コントリビュート・課題報告・機能リクエストを歓迎します。[issues ページ](https://github.com/asondemita/xcx-weather/issues) もご確認ください。
