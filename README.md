# Multi-Asset Liquidity Radar v1.1.3

## 變更

- 在「日線平均 K」的左側依序加入「S 狀態」及「中軌斜率」。
- 來源是 SStateMarketTerminal 原版 `monitor-engine.js`（`SStateMonitorEngine.analyze`），不是自行近似的 S 判斷。
- 原版引擎使用同份日線 OHLC，包含 S0/S0.5/S1/S2/S3、OTHER，以及最近 5 天中軌斜率與前 5 天趨勢差。
- 表頭可依 S 狀態、中軌斜率升降排序。平均 K 黃色優先時，先比黃黃／黃紫，再比中軌上斜方向與 S 狀態。
- **S 狀態、中軌斜率、CCI-SMA 均不參與 BTC 39 特徵模型的機率計算。**
- 無可用日線或無法載入原版引擎時顯示 `--`，不編造 S 訊號。

## 覆蓋安裝

將覆蓋包的 `index.html`、`app.js`、`style.css`、`VERSION.json` 解壓覆蓋。`symbols.js` 完全不需要改。

## 注意

`index.html` 與原版本一樣需連到外部腳本；本版額外引用 `https://youjianchonglangshou-design.github.io/SStateMarketTerminal/monitor-engine.js`。若網路或 GitHub Pages 失效，S 狀態／中軌將顯示缺值，其他欄可繼續更新。SState 原版引擎如日後更新判斷規則，本版也會跟著更新。

歷史日線在背景取得，初次開啟時可能暫時顯示 `--`。若有超過 90 秒未更新的即時價格，不顯示過期行情為即時。
