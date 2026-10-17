# Multi-Asset Liquidity Radar v1.1.0 — 多幣種即時清算總覽

## 此次改動

依使用者 2026-10-17 草圖，將 v1.0.4 的「單一幣種 K 線大圖」改成 **symbols.js 清單全部列出**的即時監控表：

1. 第一欄：自訂 `symbols.js` 幣種或美股代幣代碼、即時現價。
2. 第二欄：上方 CoinGlass 24H 清算界、NOW 現價、下方清算界，按價格比例**動態安排三條水平線的位置**；右側附各自的價格標籤，底部顯示距離現價百分比。CoinGlass 不可用時，只有在雙側有效的情況下才顯示明確標記「15M 代理估算」的價格帶。
3. 第三欄：日線平均 K（HA）黃或紫，使用 SStateMarketTerminal 日線 HA 同類遞迴公式（不是讀取 SState 的靜態快照）。每次收到即時價格時更新當日最新日 K 的平均 K 狀態；歷史資料不足則顯示 `--`。
4. 第四欄：保留原 BTC 39 特徵模型權重，套用各標的滾動 15M 資料後顯示**未校準的參考**先上掃 / 先下掃數值，較大者自動放大；模型資料缺少則 `--`，不偽造 50%/50%。

**原專案沒有被更動，亦不新增 R2 凍結、歷史結算、GitHub Actions 排程或後端。**

## 檔案

- `index.html`：總覽儀表板，載入原 BTC_iquidation 已發佈的 `coinglass-decrypt.js`、`model_predictor.js`、`probability_engine.js`；這三個現成 JS 由同一公開站點動態載入。
- `app.js`：共用資料源、CoinGlass 24H 多標的解析、滾動模型、動態三線圖、清單排序、背景 K 線更新。
- `style.css`：全新版監控表版面。
- `VERSION.json`：版本紀錄。
- `symbols.js`：使用者自訂監控清單。**覆蓋版特意不包含此檔，不要覆蓋自己的清單。**

完整包適合新目錄；覆蓋包只更新 `index.html`、`app.js`、`style.css`、`VERSION.json`。

## 更新機制

- 現價：一次批次 TradingView Scanner POST，無法取得的標的再讀一次既有 SState Cloudflare Worker 的 Pionex tickers，每 10 秒嘗試更新。超過 90 秒未成功則不再標成即時。
- CoinGlass：從原 BTC 專案已公開的解碼程式取得整份 24H 清單，一次分配所有標的，每 60 秒嘗試更新；資料老化超過 3 分鐘即失效。
- 15M 及日 K：最多同時 3 個請求，初次啟動逐行載入資料；15M 每 4 分鐘、日 K 每 12 分鐘背景更新。非每秒對全部標的重抓長期歷史。
- 日線 HA 和先掃方向參考值在收到現價時重算；若歷史 K 線缺口、站方限流、TradingView 交易對無效或模型不可用，展示 `--` 與診斷訊息。

## 特殊映射

- 使用者清單可放 `WTI` 或 `CL`：TradingView 為 `PIONEX:CLUSDT.P`、Pionex 官方 API 是 `WTI_USDT_PERP`、CoinGlass 為 `CL`。
- `PEPE` 對應 CoinGlass `1000PEPE`：上下界和參考價除以 1000，合約的金額不除。
- 其他映射沿用使用者 `symbols.js`，例如 `MUX → MU`、股票結尾 `X` 的例外；不強迫所有商品使用相同代碼。

## 安裝

1. 解壓「覆蓋包」，四個檔案放進現有專案目錄覆蓋同名檔案；**保留原 `symbols.js`**。
2. 雙擊 `index.html`，或把專案上傳 GitHub Pages。
3. 使用 CTRL+F5 清除網頁快取。如果經常出現跨網域/CORS 問題，以 GitHub Pages 的 HTTPS 網址進行真實連線測試。
4. 此版本不要求持續運轉的本機伺服器，也不會自行修改 R2 / GitHub 儲存庫。

## 測試與限制

- Chromium 模擬網路成功：19 加密幣 + 11 美股/商品，共 30 列、90 條即時價位線、30 組模型計算及平均 K；`1000PEPE` 換算、`CL` 的不同平台映射通過。
- 自訂清單只剩 ETH，或完全空白：不會中斷啟動。
- 篩選、搜尋、排序、較大機率放大通過。
- CoinGlass 模擬失敗：只對確實能找到代理上下界的標的繪圖，不製造空白資料。
- 測試中的數字全部是模擬行情，**不是即時預測或真實已驗證的跨幣種機率**。實際 CoinGlass / TV / Pionex API 在部署環境中的 403/429/CORS / 缺資料情形尚需於使用者實際瀏覽器驗證。
- 日線 HA 雖使用相同類型公式，因不同商品日 K 時段、Pionex 和 TradingView 歷史 K 線取樣等，未承諾與 SStateMarketTerminal 所有時點逐格完全一致。
