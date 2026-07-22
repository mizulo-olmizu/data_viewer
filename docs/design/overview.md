# DataViewer 設計図 — 概要

このドキュメントは、DataViewerで実現したい機能・方向性を整理するための設計図。
内容が膨らんできたら、フロントエンド固有の詳細は `frontend.md`、バックエンド固有の詳細は `backend.md` に切り出す。

## 概要

表形式のデータを「見る」ことに特化したアプリ。
行/列をスクロールして生のデータを見られる他、簡単なSQLを実行して詳細に内容を確認したり、1次元/2次元の要約プロットで、データの特性を把握しやすくする。

## モチベーション

普段データ分析を、neovim + ipythonで実行している。テキストファイルからコードをreplに送り、実行する。
コマンドラインなので、dataframeを表示した際もテキストで構成されており、行や列が多い場合は省略され、スクロールもできないので、細かく見るには追加でコマンドを打ったり、設定を変える必要がある。
なので、ipythonの関数やdataframeのメソッドとしてなどで、簡単にデータを確認できる仕組みがほしかった。
また、データの確認のために都度コマンドを実行するのも面倒なので、それもあらかじめ表示されていると便利だと思った。

## 実現したい機能(現在実現していることも含む)

duckdbをバックエンドにおいており、duckdbのUIとして機能する。

凡例: ✅ 実装済み / 🟡 実装済み・部分実装または改善の余地あり / ⬜ 未実装

### データベース
- ✅ 起動時に、メモリ上に一時的なデータベースを作成し、読み込んだデータを登録していく仕組み。
- ✅ データベースはUI上から永続化できる。
  - サイドバーのDBパス表示横に「Database」メニューを追加し、「Save Database As...」でネイティブのSaveダイアログ経由でin-memory DBの内容をファイルへ書き出せる(`save_database`コマンド、`DbState::save_database`をラップ)。file-backedで開いている間はin-memoryではないため無効化される。上書き保存にも対応(既存ファイルがあれば削除してから書き込む)。
  - Tauri IPC(UI)のみ対応。HTTP/CLIからの保存は、他インターフェースとの機能パリティ整備(フェーズ4)の一環として改めて検討する。
- ✅ 最初から永続化してあるデータベースを読み込むこともできる。
  - 起動時に読み込む場合はCLI引数`-d/--db-path`で指定する(`src-tauri/src/lib.rs`)。ファイルが存在しなければ新規作成される。single-instance再起動時やHTTP経由では無視される(既存プロセスのDB接続は実行中に切り替えない設計のため、ログに無視した旨を出力するのみ)。
  - 実行中にDBファイルを切り替えたい場合は、UIの「Database」メニューから「Open Database...」で対応(`open_database`コマンド、`AppData::dbstate`を丸ごと新しい接続に差し替える)。メモリ上に未保存のテーブルがある状態で開こうとすると、破棄される旨の確認ダイアログ(`AlertDialog`)を挟む。
- ⬜（アイデア段階） 読み込むデータベースを指定していなくても、メモリ上ではなく一時ファイルとして作成しておき、終了時に削除するようにしておけば、pythonなどとのやりとりもスムーズになるかも？
  - コード上の実装は無し。本文でも「かも？」と書かれている通り、方針未確定のため下の「未整理・検討中」に移動して検討する。

### テーブル表示
データベースから1つテーブルが選択されているのが基本。テーブルに関し、様々な情報や見方で確認することができる。
✅ 行数・列数も表示される。（`App.tsx`にバッジ表示あり）

#### スキーマ情報
- ✅ 選択したテーブルのスキーマ情報が画面左のサイドに表示される。
- 🟡 出し入れ・ドラッグでサイズ調整ができる。
  - 開閉トグル（`SidebarTrigger`）はあるが、ドラッグでの幅リサイズは未実装（shadcnの`sidebar.tsx`にリサイズ用のCSSカーソルは存在するが、実際のドラッグ操作ロジックが繋がっていない）。
- ✅ SQLを書けるので、その参考情報として書ける。
- ✅ SQLへのテーブル名やカラム名のコピーができるようにする。
  - サイドバーの各行にホバーすると、コピー(クリップボード)/SQLに挿入、の2アクションが表示される。挿入はSQLエディタのカーソル位置(選択があれば置換)に入る。挿入ボタンはSQL Editorが開いているときだけ表示される。

#### 表形式の表示
- ✅ Table要素によって表形式で表示できる。
- ✅ 仮想スクロールを導入し、データが多くてもスムーズにデータを確認できる。（`react-virtuoso`）
- ✅ フィルタリング、表示するカラムの選択、ソートなど、基本的な表操作ができるようにする。
  - ソートは実装済み（`@tanstack/react-table`）。3クリック目でソート解除(`column.toggleSorting()`)、ツールバーに「Clear sort」ボタンも追加。
  - フィルタは全体検索(グローバル、`DebouncedInput`でデバウンス)と、Excelライクな高度なフィルタ(`AdvancedFilterPanel`、ツールバーの「Filters」ボタン)の2段構成。カラムヘッダー内の簡易文字列フィルタは高度なフィルタ導入に伴い廃止した。
  - ✅ 高度な演算子(equals/not equals/contains/starts with/ends with/is one of/is null/greater than/betweenなど、列のdtypeグループごとに変える)とAND/OR(All/Any)条件を組み合わせたフィルタを実装(`src/advancedFilter.ts` + `src/components/AdvancedFilterPanel.tsx`)。ネストしたグループは無く、条件リスト全体に対する単一のAND/OR切り替えのみ。DATE/TIME/TIMESTAMP列はネイティブの`<input type="date/time/datetime-local">`をそのまま使ったpickerに、条件式をSQLのWHERE断片としてSQL Editorへ挿入する「Insert to SQL」ボタンも追加(SQL Editorが開いているときだけ表示)。詳細は下記「実装メモ」参照。
  - カラム表示切り替えは`ColumnVisibilityMenu`(共有コンポーネント、Summary側と共通)で対応。Show all/Hide allも実装。
- ✅ ソートのリセット・列の並び替え(ドラッグ&ドロップ、`dnd-kit`)・列のPin(左端固定、Pin内での並び替え含む)に対応。
  - 常時表示の行番号列(`#`、並び替え/Pin/表示切り替えの対象外の固定列、常にPin)を追加し、ソート/フィルタで行順が変わったときに視認しやすくした。
  - 列の並び替え・Pinをまとめて初期状態に戻す「Reset columns」ボタンをツールバーに追加(いずれかが初期状態から変わっている時のみ表示)。
  - 最後のPin列と通常列の間に境界線(box-shadowで表現、理由は下記「実装メモ」参照)を追加し、Pin範囲が視覚的にわかりやすいようにした。
- ⬜ 表示フォーマットをカスタマイズできる(日時の表示形式、数値のround、桁区切りのカンマ付与など)。列ごとの表示設定であり、永続化も絡むため設定画面(フェーズ2)寄りの別タスクとして扱う。
- ✅ クリップボードに保存、CSVなどでのダウンロード。
  - ダウンロードは表示中(フィルタ/ソート/列の表示・非表示・並び替え後)の内容を丸ごとCSV化するツールバーボタン(`ExportActions`)。
  - クリップボードコピーはExcel/Google Sheetsのようなセル範囲選択(ドラッグ、Shift+クリック、矢印キー/Shift+矢印キー)+Cmd/Ctrl+Cで、選択範囲のみをTSVでコピーする方式にした(全体コピー用のボタンは無い)。選択範囲自体は行番号列・見出し行を含まないが、貼り付け先で何のデータか分かるよう、コピー時のみ先頭行に列名・各行の先頭に行番号を付与している。
  - Summary(要約表示)側のクリップボードコピー/CSVダウンロードは対象外とした(AIに渡す情報コピーは別途JSON案で検討、下記「要約表示」参照)。
  - ⬜ コピー時の行番号・列名付与をon/offする設定はまだ無い(フェーズ2の設定画面待ち、下記参照)。
- 🟡 「Columns」ボタン押下からドロップダウンの中身が表示されるまで体感2秒ほどの遅延がある未解決の不具合が残っている([Issue #3](https://github.com/mizulo-olmizu/data_viewer/issues/3))。クリックイベント自体は即座に発火しており、描画(ペイント)側が遅い模様。「Columns」固有ではなく、大きなデータ(336,776行で確認)を読み込んでいる状態でRadixの`DropdownMenu`を開くと汎用的に発生する現象らしいことが、サイドバーの「Database」メニュー(下記「データベースの永続化」参照)でも同様の遅延を確認したことで分かった。

#### glimpse表示
- ✅ Rのglimpse関数のように、行/列を転置したような見方ができる。
  - 新規タブではなく、Tableタブ内のサブビュー(Grid/Glimpse切り替え)として実装(`src/GlimpseView.tsx`)。1行=1カラムで、Column名/Type/値が横一列に並ぶ。
- ✅ 各カラムにどのような要素が入っているのかが見やすくなる。
  - 先頭N件のテキストプレビューではなく、横スクロール(`@tanstack/react-virtual`による仮想化)で該当カラムの全データ行の値をそのまま見られる方式にした。
- ✅ フィルタリング、表示するカラムの選択、ソートなど、基本的な表操作ができるようにする。
  - Glimpse独自のフィルタ/ソートUIは持たず、Tableタブのツールバー(検索・高度なフィルタ・列表示切り替え)とstate(`sorting`/`columnVisibility`/`columnOrder`/`columnPinning`等)を完全共有する。列の並び替え(D&D)・Pinトグルも各行に用意し、Gridの列操作と同じ`columnOrder`/`columnPinning`を直接更新する。
- ✅ クリップボードに保存。
  - Tableと同じセル範囲選択+Cmd/Ctrl+CでのTSVコピー(`src/useCellRangeSelection.ts`に共通化)。Grid側は「ヘッダ=列名、行頭=行番号」、Glimpse側は転置して「ヘッダ=行番号、行頭=列名」。
- 詳細は下記「実装メモ」の「Glimpse表示(Tableの転置ビュー)」を参照。

#### 1行表示
- ✅ 1レコードごとに表示する。
  - 新規タブではなく、Tableタブ内のサブビュー(Grid/Glimpse/Recordの3択タブ)として実装(`src/RecordView.tsx`)。カード形式で1レコード分の全カラムを一覧できる。
- ✅ 行は1つづつになる代わりに、もっとも多く各カラムの要素をみることができるほか、目当てのレコードにジャンプして(行番号などを指定して)、どんな情報が入っているか見ることができる。
  - 値は幅の制約なく折り返し表示。Prev/Next・スライダー・ランダムジャンプ・行番号直接入力(Gridの`#`列と同じ番号体系)・Vimライクなキー操作(j/k, ←/→)に対応。
- ✅ クリップボードに保存。
  - カードごとのコピーアイコンで、そのフィールドの値のみをコピーする方式(複数選択コピーは無し)。

#### 要約表示
- 🟡 各カラムのグラフ表示と、各要約量が表示される。1次元と、2次元(2つのカラムの組み合わせ)が見れる。各カラムの型によって見る情報が異なる。
  - ✅ 数値型
    - ヒストグラム / Not Null Count / Null Count / Min / Q1 / Median / Mean / Q3 / Max / Std（`SummaryDisplay.tsx` + `db::numeric_summarise`）
  - ✅ 文字列型
    - 棒グラフ(横向き) / Not Null Count / Null Count / Unique Count / Min Length / Max Length / Value Count(otherバケット含む)
  - ✅ 日付・時間
    - 数値型と同じ構成でStdなし（`db::temporal_summarise`）
  - ✅ Bool型
    - 棒グラフ(横向き) / Not Null Count / Null Count / Value Count
  - ⬜ 数値 or 日付・時刻 × 数値 or 日付・時刻（散布図/ヒートマップ）
  - ⬜ 数値 or 日付・時刻 × 文字列 or Bool（箱ヒゲ図）
  - ⬜ 文字列 × 文字列（ヒートマップ）
  - ⬜ 文字列 or Bool × Bool（積み上げ棒グラフ）
  - → 2次元の要約は4パターンすべて未実装（フロントのUI・コンポーネントもバックエンドのペア集計クエリも無し）。
- 🟡 グラフは軸などはなく、グラフの形だけが表示されている状態で、クリックすると、軸などが表示されるほか、データをフィルタしたりなどインタラクティブなグラフになる。
  - 存在する2種類（ヒストグラム・ValueCounts）については実装済み（`HistogramChartInteractive`/`ValueCountsChartInteractive`、ヒストグラムは範囲フィルタやbin数変更も可能）。2次元チャートが無いためカバー範囲は半分。
- ✅ グラフにはツールチップが表示される。（`@visx/tooltip`）
- ✅ 表示するカラムの選択ができる
  - `ColumnVisibilityMenu`(Tableビューと共通のコンポーネント)で対応。
- 🟡 グラフは要約量の表示は、インタラクティブなグラフも含め、軽量な操作ができるようにする。(大規模なデータが入る可能性もあるため)
  - 既存の1次元チャートはDB側で集計してから描画しており軽量。2次元が未実装のためこの観点も未検証。

#### その他
- ⬜ データの情報、スキーマや各カラムのフィールド例、サイズなどを、AIに渡しやすいテキスト情報でコピーできるようにする
  - 関連コードなし。当初はSummary(要約表示)のCSVコピー/ダウンロードとして検討したが、AI向けであればCSVよりJSON形式の方が適切という判断になり、フェーズ3の本項目としてやり直す方針にした。
- ⬜（アイデア段階）[missingno](https://github.com/ResidentMario/missingno)のような、NULL値の分布・欠損パターンを可視化する機能。カラムごとの欠損有無を俯瞰できるようにする。
  - 関連コードなし。配置(Table/Summaryと同階層の独立ビューにするか、Summary内に組み込むか)は未定のため、詳細は下記「未整理・検討中」を参照。

### データのインプット
- ✅ アップロードボタンから
- ✅ ファイルのドラッグアンドドロップ
- ✅ ファインダーからファイルを開く(file associations)
- ✅ SQLでの取り込み・書き込み
- ✅ HTTPから
  - 「他プロセスからHTTP経由でデータ登録する」という意味。`/update-data`エンドポイントでローカルファイルパスを指定してのデータ登録として動作している（`data_viewer_py`が使っている経路）。
  - 🟡 ただし、他のインターフェース（Tauri IPC・CLI）でできることのうち、HTTP経由ではまだできないものがある（SQL実行など）。インターフェース間の機能パリティを取る必要あり。詳細は下記「インターフェース」参照。
- ✅ CLIから
  - ✅ HTTPやCLIだと、スキーマを指定して読み込むことができるようにする。（`infer_schema_length`/`file-type`/`separator`/`name`をHTTP・CLI双方でサポート）
  - 補足: 現状の「CLI」はアプリ本体をargv付きで起動する方式で、GUIと独立した軽量CLIバイナリは存在しない。
- ⬜ データが大きすぎる場合、一部のみを取り組む(LIMIT追加する)ように促すダイアログがでてくる。

### SQL Editor
- ✅ データベースを対象にして、SQLを実行できる。
- 🟡 画面右側のサイドパネル。出し入れ、ドラッグでサイズ調整ができる。
  - 左のスキーマパネルと同じ`Sidebar`コンポーネント(`side="right"`)を再利用し、非モーダル・押しのけ式のパネルとして実装済み(背景を暗くせず、外側クリックでは閉じない)。開閉はトグルボタン/閉じるボタン/Escキーで行う。ドラッグでのサイズ調整は未実装(固定幅)。
- ✅ バックエンドがDuckDBなので、DuckDBのSQLの文法が使える。
- ✅ VSCodeのように、予約語などの補完が効く。（`get_duckdb_symbols`でDuckDBの実ビルドから動的取得）
- ✅ SQLのフォーマットも可能。（`sqruff-lib`）
- ⬜ いくつか(1~10くらい)SQLを保持しておける。
  - クエリ履歴の仕組みは無し。
- ✅ デフォルトで、現在表示しているテーブルのカラム名・テーブル名が入っているサンプルクエリが配置されている。
- ✅ 実行結果は、"_last"というテーブルに保持される。

### インターフェース
- 🟡 http(ローカルホスト)、cliで、データの登録・更新、SQLの実行ができるようにする。
  - データの登録・更新はHTTP・CLIとも実装済み。SQLの実行はTauri IPC（`execute_query`）のみで、HTTP経由のSQL実行エンドポイントは無い。
  - 方針: Tauri IPC・HTTP・CLIの3つのインターフェースで機能パリティを取り、どこから操作しても同じことができるようにしたい（特にSQL実行・スキーマ取得のHTTP対応が優先度高）。
- ⬜ MCPを用意し、AIからでも、テーブル・スキーマ情報の取得やSQLの実行・結果の取得ができ、登録されているデータの探索ができるようにする。
  - MCPサーバーのコードは存在しない。
- 🟡 PythonやRのライブラリを用意し、ipythonのmagicやメソッドで、データを表示する代わりに、このアプリで見れるようにする。(`../data_viewer_py`と`../data_viewer_r`)
  - Python (`data_viewer_py`): データをtempファイルに書き出し、health-check→未起動なら起動→`/update-data`にPOST、という一連の流れとpandas/polarsのモンキーパッチ、IPython magicが動作する実装として存在する。データ登録のみでSQL実行やスキーマ取得はまだ無い。
  - R (`data_viewer_r`): `DESCRIPTION`/`NAMESPACE`でパッケージの体裁と`launch_data_viewer`のexportは宣言されているが、`R/`以下に実装本体が無く、現状ビルドできないスタブ状態。

### アプリケーション的な要素
- ✅ シングルトンにする。(複数windowではなく、1つのwindowが更新されるようにする)
- ✅ HTTPやCLIからの操作があったら、起動していない場合は起動、起動している場合は最前面に来るようにする。

### 設定
- ⬜ 各種設定ができる。
  - 設定画面・設定ストア自体が存在しない。永続化されているクライアント側状態はテーマ文字列（`localStorage`の`dataviewer-ui-theme`）のみ。
  - 🟡 デザイン(プライマリ・セカンダリカラー、ライト・ダーク)
    - ライト/ダーク/システム追従は実装済みだが、手動切り替えUI（トグル）が見当たらない。プライマリ・セカンダリカラーのカスタマイズは無し。
  - ⬜ LIMITのダイアログが出る件数
    - ダイアログ自体が無いため未実装。
  - 🟡 infer_schema_length(型を推論するために読み込む行数)
    - CLI/HTTPのリクエストごとのパラメータとしては存在するが、アプリ全体のデフォルト設定としての永続化は無い。
  - ⬜ 起動時に、何か外部から操作があったら最前面に来るようにするか。
    - 動作自体はハードコードで実装されているが、on/offを切り替える設定は無い。
  - ⬜ HTTPサーバーのポート番号
    - 現状は起動時のCLI引数(`-p/--port`)でのみ指定可能で、アプリ全体のデフォルト設定としての永続化は無い。
  - ⬜ その他、定数化しているところなど

## デザイン方針

UI/UXの方向性についての指針。まだ細部は詰まっていないが、判断に迷ったときの拠り所とする。

### トーン
- データ分析ツール系(Tableau, Observableなど)寄りの方向性。グラフや色を活かして、データそのものが持つ情報を的確に見せることを重視する。装飾のための装飾はしない。
- 用途的にはミニマルさが大事だが、無機質になりすぎず少し遊び心がある見た目にしたい。イメージとしては、shadcn/uiのデフォルトよりdaisyUIのデフォルトに近い質感(角の丸み、コンポーネントの表情など)。
- 遊び心はあくまで「控えめなアクセント」に留め、主役であるデータの視認性・情報の伝わりやすさを邪魔しない範囲にする。

### 情報密度
- 密度重視。1画面になるべく多くの情報を詰め込む方向にする。フォントサイズや余白は控えめにし、neovim + ipythonで作業していた頃の感覚(コマンドライン的な密度)に近づける。

### 配色
- 白黒中心のニュートラルではなく、少し紺・青みがかったニュートラルを基調にしたい。Catppuccinのような、パステル寄りで温かみのある配色を参考にする。
- アクセントカラーの数(1色に絞るか、Catppuccinのように複数の意味づけられた色を使うか)は未確定。実際にパレットを試作しながら決める。
- 「設定」で検討しているプライマリ・セカンダリカラーのカスタマイズと整合させる(ユーザーがアクセント/ベースの配色をある程度変更できるようにする)。
- 具体的なカラーパレット(HEX値など)は、実装フェーズでプロトタイプを作りながら別途詰める。

### 可視化(チャート)
- visxで描画するチャートは、ホバーや表示切り替え時のアニメーションなど、少し目を引く軽い動きを入れる。
- ただし主役はデータなので、装飾のためだけのアニメーション(chart-junk)にはしない。データの理解を助ける、または操作のフィードバックとして機能する範囲に留める。

### 操作方針
- キーボード操作・マウス操作を同等にサポートする。
  - キーボード: ショートカット、将来的にはコマンドパレットのようなものも検討候補。
  - マウス: ボタン、ドラッグ&ドロップ、クリックによるインタラクティブ表示への切り替えなど。
- ⬜ キーボードショートカットは、機能を実装するたびに都度場当たり的に追加するのではなく、アプリ全体でのキー割り当てをまとめて設計してから実装する方針にしたい。個別実装を積み重ねると、キーの衝突や「同じような操作なのに機能ごとにキーが違う」といった一貫性の欠如につながるため。
  - 現状、既に場当たり的な実装が複数ある(Table.tsxの矢印キー/Cmd+C/Cmd+A、RecordViewのj/k・矢印キー、SQLエディタのEscapeなど)。まとめて設計するタイミングでこれらも棚卸し・見直しの対象に含める。

## 重視したいこと
- 大規模なデータが入力される可能性があるため、データの取り込みや、表示、表示切り替えの際などに、なるべく待ち時間が発生しないようにする。処理時間がなるべく短くなるようにする。

## 実装状況サマリー

| 領域 | ✅ 実装済み | 🟡 部分実装/改善余地 | ⬜ 未実装 |
|---|---|---|---|
| データベース | 起動時のメモリDB作成・登録、UIからの保存/オープン、CLIでの起動時読み込み | - | 一時ファイル化案 |
| テーブル表示(表形式) | Table描画、仮想スクロール、行/列数表示、スキーマ名コピー/挿入、フィルタ(全体検索+Excelライクな高度なフィルタ)、カラム表示切り替え、ソート(3状態リセット込み)、列の並び替え(D&D)/Pin/一括リセット、常時表示の行番号列、セル範囲選択コピー(TSV)/CSVダウンロード | サイドバーリサイズ、Columnsボタンの表示遅延(Issue #3) | 表示フォーマットのカスタマイズ |
| glimpse表示 | Tableタブ内のGrid/Glimpseサブビュー切り替え、転置表示(1行=1カラム)、横スクロールでの全件値表示(仮想化)、行のD&D並び替え/Pin、セル範囲選択コピー、フィルタ/ソート/列表示のTableとの完全共有 | - | 行クリックでのドリルダウン等のインタラクション |
| 1行表示 | Tableタブ内のRecordサブビュー(カード形式)、Prev/Next/スライダー/ランダム/行番号ジャンプ、Vimライクなキー操作、フィールド単位のコピー、カードのD&D並び替え | - | - |
| 要約表示(1次元) | 数値/文字列/日付/Bool の chart+統計量、ツールチップ、カラム表示切り替え | インタラクティブ化(2次元分は対象外) | 2次元要約全パターン、AI向けテキストコピー |
| データのインプット | アップロード/D&D/Finder/SQL/CLI/HTTP(登録) | - | LIMIT確認ダイアログ |
| SQL Editor | 実行/補完/フォーマット/デフォルトクエリ/`_last`保存/非モーダル押しのけパネル | パネルのドラッグリサイズ | クエリ履歴 |
| インターフェース | シングルトン化、外部操作での起動/最前面化 | HTTP・CLI(登録のみ、SQL実行不可)、Python lib | MCP、R lib(実装コード無し) |
| 設定 | - | テーマ(自動のみ)、infer_schema_length(リクエスト単位) | 設定画面自体、その他すべての永続設定 |

## 今後の計画

いずれ全項目を実装する前提で、推奨する着手順序。「日常的にひとりで使うビューアとしての完成度」を先に上げ、「見た目の土台」を早めに固定し、その後「機能の厚み」「他プロセス/AI連携」の順に広げる考え方。

### フェーズ0: 既存実装の小さな修正 ✅ 完了(2026-07-21)
最初にやっても損がない、独立した小さい修正。
- ✅ 列数バッジのラベルバグ修正（「Rows」→「Columns」）。
- ✅ スキーマパネルのテーブル名・カラム名コピー機能追加（クリック→クリップボード、または SQL エディタへの挿入）。
  - 想定より作り込み、SQL Editorのモーダル→非モーダル押しのけパネル化、カーソル位置への挿入まで実装。副産物としてButtonコンポーネントのforwardRefバグ修正も行った。

### フェーズ1: 「見る」体験の主要な抜け漏れを埋める ✅ 完了(2026-07-22)
モチベーションの中心である「データを素早く確認する」体験を完成させる。使用頻度が最も高く、価値が一番わかりやすい部分。
- ✅ テーブル/Summaryビューへのフィルタリング・カラム選択の追加。ソートのリセット、列の並び替え(D&D)、列のPinも合わせて対応(`feature/table-filter-column-select`ブランチ)。
- ✅ Tableビューのクリップボードコピー(セル範囲選択+Cmd/Ctrl+C) / CSVダウンロード対応(`feature/table-copy-csv-export`ブランチ)。Summary側は対象外(詳細は「テーブル表示」節参照)。
- ✅ Excelライクな高度なフィルタ(is equal to/contains/is null/greater than/betweenなどの演算子 + AND/OR条件の組み合わせ)。上記の簡易フィルタ(文字列部分一致)を置き換える形で実装(`feature/table-advanced-filter`ブランチ)。詳細は下記「実装メモ」参照。
- ✅ glimpse表示(Tableタブ内のGrid/Glimpseサブビューとして実装、`feature/glimpse-view`ブランチ)。詳細は下記「実装メモ」参照。
- ✅ 1行表示(新規ビュー、行ジャンプ含む。Tableタブ内のRecordサブビューとして実装、`feature/record-view`ブランチ)。詳細は下記「実装メモ」参照。

### フェーズ2: デザインの土台と設定・永続化まわり
「デザイン方針」で決めた方向性（配色・遊び心・可視化の質感）を実際にUIへ反映するタイミング。ここを先に固めておくと、以降作る画面（要約表示の拡張など）を二度手直しせずに済む。
- 設定画面の新設（テーマ手動切り替え、プライマリ/セカンダリカラー、LIMITダイアログ閾値、infer_schema_lengthのデフォルト値、起動時最前面化のon/off、Tableのセル範囲コピー時に行番号・列名を付与するかのon/off）。
- テーブルの表示フォーマットのカスタマイズ（日時の表示形式、数値のround、桁区切りのカンマ付与など）。列ごとの表示設定であり、設定の永続化とも絡むためここで扱う。
- 配色・コンポーネントの質感をデザイン方針に沿って更新（ニュートラルカラーの見直し、アクセントカラーの適用範囲決定）。
- ✅ データベースのUIからの永続化（`save_database`をコマンド化してUIに接続）と、起動時の永続DB読み込み(`feature/database-persistence`ブランチ)。詳細は下記「実装メモ」参照。
- LIMIT確認ダイアログの実装（大規模データ取り込み時）。
- SQLエディタのクエリ履歴、パネルのドラッグリサイズ（スキーマパネルも含む）。
- アプリ全体のキーボードショートカット設計（個別機能ごとの場当たり的な追加をやめ、既存の場当たり的な実装も含めてまとめて棚卸し・設計・実装する。詳細は「デザイン方針」の「操作方針」参照）。

### フェーズ3: 要約表示の拡張
土台が固まった上で、バックエンドの新規集計ロジックとフロントの新規チャートを要する、比較的コストの大きい機能拡張。
- 2次元要約（散布図/箱ヒゲ図/ヒートマップ/積み上げ棒グラフ）のバックエンド集計とフロント実装。
- visxチャートへのアニメーション追加（デザイン方針の「可視化」を反映）。
- AIに渡しやすいテキスト情報のコピー機能。

### フェーズ4: 外部インターフェースの拡充
ひとりでアプリを直接使う分には無くても困らない、他プロセス/AI連携のための拡張。優先度は最も低い。
- Tauri IPC・HTTP・CLIの機能パリティを取る（HTTP経由でのSQL実行・スキーマ取得エンドポイント追加が優先）。
- MCPサーバーの新規実装。
- `data_viewer_r`の実装（Rパッケージの中身）。
- `data_viewer_py`の拡張（SQL実行・スキーマ取得など）。

## 実装メモ・技術的な決定事項

実装を進める中で調べた、技術的な制約と対応方針のメモ。機能実装時はここも確認する。

### アプリ内D&D と Tauriのファイルドロップの両立
- 前提・課題: Tauri(WebView2/WebKit)には、`dragDropEnabled: true`(OSからのファイルドロップを有効化する設定)にしていると、HTML5ネイティブのDrag APIを使うReactライブラリ(`react-dnd`、`react-beautiful-dnd`など)がブロックされて動作しなくなる、という排他的な制限がある。Tauriのアップデートでもこの制限は変わっていない。
- 対応方針: ファイルドロップ(`dragDropEnabled: true`)は維持したまま、アプリ内の要素D&Dには HTML5 Drag APIではなく **Pointer/Mouseイベントベースで動くdnd-kit** を採用し、競合を回避する。

### React 19以降へのアップグレード ✅ 対応済み(2026-07-21)
- 前提・課題: 現状React 18.3系。React 18では関数コンポーネントは`ref`を自動で受け取れず、`React.forwardRef`で明示的に転送する必要がある。shadcn/uiの`Button`コンポーネントがこれをやっていなかったため、`TooltipTrigger asChild`経由でrefが`Button`に渡らず、Tooltipが正しく表示されないという実害のあるバグが発生した(`forwardRef`化して対応済み)。React 19では関数コンポーネントが`ref`をpropとして直接受け取れるようになり、`forwardRef`によるボイラープレートが不要になる。
- 対応方針: React 19(またはそれ以降の最新版)へアップグレードし、`forwardRef`を使った箇所をシンプルな形に書き直す。このような不整合を今後生まないため。
- 実施内容: `react`/`react-dom`/`@types/react`/`@types/react-dom`をv19系へ、peer依存の関係で`@visx/*`一式もv4系(React19対応)へ更新。`Button`(`src/components/ui/button.tsx`)・`SQLEditor`・`Table`内の`TableComponent`の3箇所にあった`React.forwardRef`を、`ref`をpropとして直接受け取る形に書き換え。

### TypeScript/フロントエンドへのPrettier導入 ✅ 対応済み(2026-07-21)
- 前提・課題: 現状、TS/TSX側にlinter・formatterが無く(CLAUDE.md記載の通り)、インデントなどが崩れやすい。
- 対応方針: Prettierを導入し、保存時/コミット時などにフォーマットが自動で揃うようにする。
- 実施内容: Prettier本体と`.prettierrc`/`.prettierignore`を追加し、`npm run format`/`npm run format:check`スクリプトを整備。対象はTS/TSX等のフロントエンドコードのみとし、Markdownは対象外にした。既存コード全体に一括フォーマットを適用済み。保存時/コミット時の自動化(エディタ設定・pre-commitフック)は未着手。

### TypeScript/フロントエンドへのESLint導入 ✅ 対応済み(2026-07-21)
- 前提・課題: Prettierに続き、JS/TS側にはlinter(eslint)がまだ無い。フォーマットとは別に、未使用変数・hooksの依存配列漏れなどをコードレビュー前に機械的に検知したい。
- 対応方針: Prettierとは別タスクとして着手する。`typescript-eslint`・`eslint-plugin-react-hooks`などのルールセット選定と、既存コードとの整合を取る作業が必要なため。
- 実施内容: flat config(`eslint.config.js`)で`typescript-eslint`(recommended) + `eslint-plugin-react-hooks`(recommended、React Compiler由来のpurity/set-state-in-effect等のルールを含む最新版) + `eslint-plugin-react-refresh` + `eslint-config-prettier`を導入し、`npm run lint`スクリプトを追加。検出された指摘は全て今回のPR内で解消(warningも含め0件): `any`型の排除、`Table.tsx`/`HistogramChart.tsx`/`ValueCountsChart.tsx`でearly returnより後にHooksを呼んでいたRules of Hooks違反の修正、`ChartTooltip.tsx`/`sidebar.tsx`でのrender中の`Math.random()`呼び出し(purity違反)の修正、エフェクト内での同期的setStateを「adjust state while rendering」パターンや`useSyncExternalStore`に置き換え、`App.tsx`でのuseEffect内`duckdbSymbols`参照が古い値を掴む問題をref経由の参照に修正、shadcn/ui由来のフック・contextを別ファイルに分離してFast Refresh警告を解消。

### スキーマパネルのコピー/挿入ボタンのTooltip位置がずれるバグ ⬜ 未修正
- 詳細・調査状況は [Issue #1](https://github.com/mizulo-olmizu/data_viewer/issues/1) を参照。

### STRUCT/LIST/MAPなどネスト型カラムを含むデータでSummary表示がクラッシュするバグ ⬜ 未修正
- 詳細・調査状況は [Issue #10](https://github.com/mizulo-olmizu/data_viewer/issues/10) を参照。「1行表示」実装時の動作確認中に発見(1行表示自体の不具合ではなく、既存の`SummaryDisplay.tsx`起因)。

### Tableビューのフィルタ/カラム選択/並び替え/Pin ✅ 対応済み(2026-07-22)
- 前提・課題: フェーズ1の最初のタスクとして、Tableビューにフィルタ・カラム表示切り替え・ソートリセット・列の並び替え(D&D)・列Pinを追加。dnd-kitの実導入は初めて(CLAUDE.mdの「アプリ内D&D」の項では方針決定のみで未実装だった)。
- 対応方針・実施内容:
  - フィルタは`getFilteredRowModel`+`columnFilters`/`globalFilter`を使用。tanstack-tableの`filterFn`/`globalFilterFn`のデフォルト(`"auto"`)は数値カラムだと範囲指定用の`inNumberRange`になり文字列フィルタが機能しないため、`"includesString"`を明示指定した。
  - 列の並び替え(`dnd-kit`)は、Pin済み/未Pinの2グループそれぞれに`SortableContext`を分け、Pin状態を跨ぐドラッグは無視するようにした。ドラッグ中は`@dnd-kit/modifiers`の`restrictToHorizontalAxis`で縦方向の動きを止めている。
  - 列Pinはtanstack-tableの`columnPinning`機能をそのまま使用。`columnOrder`(並び順)とは独立したstateとして扱い、お互いの配列を書き換えないため、Pin中/非表示中の列も`columnOrder`上の位置を保持し続け、解除時にその位置へ自然に復帰する(詳細は`src/Table.tsx`のコメント参照)。
  - ドラッグで押しのけられる列は、ヘッダーだけでなくbodyのセルも一緒に動くようにするため、各ヘッダーセルが自分の`useSortable().transform`を親コンポーネントへ都度報告し、対応するbodyセルに同じtransformを適用する仕組みを実装(`ColumnTransform`/`handleTransformChange`)。
  - 常時表示・常時Pinの行番号列(`#`は付けずヘッダーは空)を追加。tanstack-tableの`columns`には含めず、`INDEX_COLUMN_WIDTH`分オフセットした上で他のPin列のsticky位置を計算する形にした。これにより「最後の1列は非表示にできない」ようなハックが不要になり(常に行番号列があるため`react-virtuoso`がゼロ幅でクラッシュしない)、Show all/Hide allも素直に全データ列へ適用できる。
  - Pin列のhover時、`bg-muted/50`(半透明)を使うと横スクロール時に後ろの内容が透けて見えるバグがあった。かといって`bg-muted`(不透明)にすると非Pin列と色が揃わない。`color-mix(in oklch, var(--muted) 50%, var(--background) 50%)`で「muted 50%をbackgroundに重ねた見た目」を不透明色として直接計算することで解決した。
- ハマりどころ:
  - **react-virtuosoへ渡す`components`/`fixedHeaderContent`を`useMemo`/`useCallback`で固定するとフィルタ入力のフォーカス喪失やクリック取りこぼしが直ると予想したが、逆に列の並び替え・Pin・フィルタ・カラム選択が反映されなくなる重い regression を引き起こした。** react-virtuosoは`components`の参照を見て再計算要否を判断していると見られ、安易な固定は禁物。元の「毎レンダー生成」に戻して問題は解消した。
  - **カラムごとのフィルタ入力で使っていた`DebouncedInput`のdebounce用`useEffect`が、`onChange`を依存配列に含めていたことで無限ループになった。** `onChange={(value) => column.setFilterValue(value || undefined)}`は`column`オブジェクトを毎レンダー作り直すクロージャで参照が安定しないため、「`setFilterValue`呼び出し→再レンダー→`onChange`再生成→依存配列変化でeffect再実行→`setFilterValue`呼び出し…」というループになり、CPUを常時消費し続けて行のhover表示がちらつく、Columnsボタンの反応が遅くなるなど広範囲に症状が出た。`onChange`はrefで保持し、依存配列は`value`/`debounce`のみにすることで解消。同様に、列を押しのける際のtransform共有でも「値が変わっていなくても毎回新しいオブジェクトを返す」ケースで同種のループが再発したため、`setColumnTransforms`側で値の変化を比較してから更新するようにした。**このパターン(`useEffect`の依存配列に「呼び出し側で毎レンダー作り直されるコールバックやオブジェクト」を入れる)は無限ループの典型的な原因になるため、以後も要注意。**
- 残課題: 「Columns」ボタン押下からドロップダウンの中身が表示されるまで体感2秒ほどの遅延がある不具合が未解決([Issue #3](https://github.com/mizulo-olmizu/data_viewer/issues/3))。クリックイベント自体は即座に発火しているため、描画(ペイント)側の問題と推測されるが原因未特定。データベースの永続化機能(下記)の実機確認中に、サイドバーの「Database」ドロップダウンメニューでも同じ現象(336,776行のデータで再現、小さいデータでは発生しない)が確認され、「Columns」固有ではなく大きなデータ+Radixの`DropdownMenu`一般の問題らしいという追加の手がかりが得られた([コメント](https://github.com/mizulo-olmizu/data_viewer/issues/3#issuecomment-5046955462)参照)。

### Tableビューのクリップボードコピー(セル範囲選択) / CSVダウンロード ✅ 対応済み(2026-07-22)
- 前提・課題: フェーズ1の2つ目のタスク。当初はTable/Summary双方に「全体コピー」「CSVダウンロード」ボタンを実装したが、レビューで方向転換した。
  - Summaryは対象外にした: CSVコピー/ダウンロードできる必要は無く、AIに渡す用途ならCSVよりJSONの方が適切という判断のため(「テーブル表示」節の「その他」、フェーズ3で扱う)。
  - Tableのコピーは「全体をボタンでコピー」ではなく、Excel/Google Sheetsのように「セル範囲を選択してCmd/Ctrl+Cでコピー」という形に作り直した。CSVダウンロードはボタン方式のまま維持。
- 対応方針・実施内容:
  - 選択はデータセルのみ対象(行番号列・見出し行は選択不可)。クリックで単一セル選択、ドラッグまたはShift+クリックで矩形範囲に拡張、矢印キー/Shift+矢印キーでも移動・拡張できる。選択状態は`{anchor, focus}`という2点の`{rowIndex, colIndex}`で管理し(`Table.tsx`の`CellSelection`)、`rowIndex`はフィルタ/ソート後の表示順(`row.index`)、`colIndex`はPin列→通常列の表示順(`orderedColumnIds`)に対応させている。そのため、ソート・フィルタ・列の表示切り替え・並び替え・Pinのいずれかが変化した時点で選択位置は意味を失うので、都度リセットするようにした(`onSortingChange`等のuseReactTableコールバックをラップ)。
  - コピーはCmd/Ctrl+Cのキー操作のみで、専用ボタンは無い。TSV形式(タブ区切り、`\r\n`改行)でクリップボードへ書き込む(`toTsv`、`db::`側と同様スプレッドシート貼り付けを想定)。選択範囲自体は行番号・列名を含まないが、貼り付け先で何のデータか分かるよう、コピー時のみ先頭行に列名・各行の先頭に行番号を付与している(将来的に設定でon/off切り替え予定、フェーズ2)。
  - キーボード操作(矢印キー/Cmd/Ctrl+C)を受け取るため、テーブルの外側コンテナに`tabIndex={0}`を設定し、セルの`mousedown`ハンドラ内で明示的に`.focus()`している。
  - 矢印キーでの選択移動時、選択行が仮想スクロールの表示範囲外に出た場合は`react-virtuoso`の`TableVirtuosoHandle.scrollToIndex()`で追従させる。
  - CSVダウンロードは表示中(フィルタ/ソート/列の表示・非表示・並び替え後)の全データをCSV化する。保存は`@tauri-apps/plugin-dialog`の`save()`でパスを選び、新規追加したTauriコマンド`save_text_file`(`src-tauri/src/modules/handler.rs`、中身は`std::fs::write`)で書き込む。`tauri-plugin-fs`は導入せず、既存の他コマンドと同じ「シンプルな自前コマンド」方針にした(パーミッションのスコープ設定が不要で、既存アーキテクチャとも整合するため)。
- ハマりどころ:
  - **セルの`mousedown`で`e.preventDefault()`しているため、ブラウザ標準のフォーカス移動が起きず、矢印キー/Cmd+Ctrl+Cのキーイベントを外側コンテナが受け取れなかった。** `mousedown`ハンドラ内で`tableContainerRef.current?.focus()`を明示的に呼ぶことで解決。
  - **`npm run tauri dev -- -- -i path/to/file.csv`(CLAUDE.md記載の従来の書き方、`--`2つ)では、アプリ本体への引数`-i ...`が`cargo run`自体の引数として渡ってしまい、`error: unexpected argument '-i' found`でクラッシュした。** npm自身が最初の`--`を1つ消費するため、実際にアプリまで届けるには`--`を3つ重ねる必要がある(`npm run tauri dev -- -- -- -i path/to/file.csv`)。CLAUDE.mdの「動作確認」節を修正済み。
- 残課題: ヘッダー(見出し行)・行番号列自体を選択対象にする案も検討したが、選択モデルを`rowIndex`が仮想の行(見出し行を`-1`など)まで拡張する必要があり、`fixedHeaderContent`が`TableVirtuoso`のボディ行とは別レンダリング経路になっている都合上そこそこの手間がかかるため、今回は見送った(コピー時に列名・行番号を自動付与する方式で代替)。

### Tableビューの高度なフィルタ(Excelライクなフィルタ) ✅ 対応済み(2026-07-22)
- 前提・課題: フェーズ1の3つ目のタスク。既存の列ヘッダーの単純な文字列部分一致フィルタ・全体検索だけでは、正確な絞り込み(等しい/より大きい/範囲/is null/複数値のいずれかなど)ができなかった。
- 対応方針・実施内容:
  - UIはAirtable/Notion方式の独立した「Filters」パネル(Popover、`src/components/ui/popover.tsx`を新規追加)を採用。ネストしたグループは作らず、条件リスト全体に対する単一のAND/OR(All/Any)切り替えのみに絞った(Excel本来のカスタムオートフィルタも列ごとに2条件+AND/ORが上限で、ネスト無しが実用上十分なため)。
  - 演算子は列のdtypeグループ(`numeric`/`temporal`/`duration`/`string`/`boolean`/`nested`/`other`)ごとに`OPERATORS_BY_DTYPE_GROUP`で用意し、`is one of`(カンマ/改行区切りの複数値)も含めた(`src/advancedFilter.ts`)。
  - 実装は`useReactTable`の`data`に渡す手前で`applyAdvancedFilter`により事前フィルタする方式(`useMemo`)。既存のソート・列フィルタ・全体検索・仮想スクロールの仕組みには一切手を入れていない。これに伴い、列ヘッダーの簡易文字列フィルタ(`columnFilters`)は不要になったため完全に削除した(全体検索のみ残存)。
  - 実装中の追加提案でDATE/TIME/TIMESTAMP列にネイティブの`<input type="date/time/datetime-local">`を使ったpickerを追加、条件式をSQLのWHERE断片として`SQLEditorHandle.insertAtCursor`経由でSQL Editorへ挿入する「Insert to SQL」ボタン(スキーマパネルの挿入ボタンと同じ`sqlEditorOpen`時のみ表示パターンを踏襲)も追加した。
- ハマりどころ:
  - **`columnType`(`ColumnInfo.columnType`)は、Rust側の`DuckDBType` enumのバリアント名がserdeのデフォルト(外部タグ形式)でそのままJSON化されたものなので、"DATE"ではなく"Date"のようなパスカルケースになる。** SQL型名の文字列("DATE"等)だと思い込んで`temporalInputKind`の分岐を書いたため、date/time/datetime pickerが最初全く発火しなかった。`cargo test`に一時的なprobeテストを書いて実際のJSON形式を確認して修正した。
  - **TauriのWKWebView(macOS)では`<input type="time">`だけポップアップ的なピッカーUIが表示されない。** DATE/TIMESTAMP(datetime-local)はカレンダー/セグメント編集(矢印キーで時/分/秒を個別に操作)ともにネイティブに機能するが、TIMEはポップアップが出ないだけで、セグメント編集自体は同様に機能する。ピッカーが出ないことを理由に一度テキスト入力へフォールバックさせたが、実際は`type="time"`のまま使って問題ないと分かり差し戻した。
  - **列を切り替えたときに、直前の値が誤って引き継がれるバグを2段階で作り込んだ。** 最初は「演算子が新しい列のdtypeグループでも有効か」だけを見て値を引き継ぐかどうか判定していたため、numericとtemporalが両方`equals`を持つことから、numeric列で入力した値がtemporal列に切り替えても引き継がれてしまった(`"signup_date" = '1'`のような壊れたSQLが生成される)。dtypeGroup同士の一致を見るよう修正したが、今度はdate/datetime/timeのように**dtypeGroupが同じ`temporal`のままpickerKindだけが変わる**ケースで同じ問題が再発した。最終的に「列名が変わったら値は常に空にリセットする(演算子は新しい列でも有効なら維持)」という単純なルールに倒し、この種のバグの再発を防いだ。
  - **ネイティブのdate/time/datetime-local inputは、値が空文字でも「今日の日付」「現在時刻」らしき表示を初期状態として見せる。** 見た目は値が入っているように見えるのに`condition.value`は空文字のままで、"Insert to SQL"がグレーアウトしたままになる、という混乱を生んだ。条件の新規作成時・列切り替え時にstate側にも同じ値(`defaultTemporalValue`)をあらかじめ入れることで解消した。
  - `TIMESTAMP WITH TIME ZONE`は、arrow_jsonがUTC正規化+`Z`付き文字列("...T...Z")としてシリアライズするため、タイムゾーン情報を持てない`datetime-local`の値形式と合わずピッカー非対応(テキスト入力にフォールバック)のままにした。将来的に対応したい場合の論点は[Issue #6](https://github.com/mizulo-olmizu/data_viewer/issues/6)を参照。
  - ツールバー内の「Clear filters」ボタンは、高度なフィルタパネルを導入した際に「パネル内のClear All・全体検索の×ボタンで足りる」と判断し一度削除したが、実際に触った結果「あった方が便利」となり復活させた(Filtersボタンの右・Clear sortの左に配置)。

### Glimpse表示(Tableの転置ビュー) ✅ 対応済み(2026-07-22)
- 前提・課題: フェーズ1の4つ目のタスク。Rの`glimpse()`のように、行/列を転置してカラムごとの型・値を一覧できるビューを追加する。
- アーキテクチャ判断: 当初はApp.tsx直下の3つ目のトップレベルタブとして検討したが、それだとTableの現在のフィルタ・ソート・列表示/非表示stateをTable.tsxの外へ持ち上げて共有する必要があり大掛かりになるため、**Tableタブ内のサブビュー(Grid/Glimpse切り替え、`src/Table.tsx`のツールバーに`Tabs`で追加)**として実装する方針に変更した。これによりTable.tsx内の`sorting`/`globalFilter`/`advancedFilterConditions`/`columnVisibility`/`columnOrder`/`columnPinning`stateと、そこから導出される`rows`(フィルタ・ソート済み行モデル)・`orderedColumnIds`(Pin→通常の表示順)をそのまま`<GlimpseView>`にpropsで渡すだけで共有できる。
- 値の見せ方: 先頭N件をテキストで並べる案から、**横スクロール(仮想化)で該当カラムの全データ行の値をそのまま見られる方式**に変更した(一部だけだと偏った値しか見えないため)。横方向の仮想化には、既存の`react-virtuoso`(縦方向専用)ではなく`@tanstack/react-table`と同じTanStackファミリーの**`@tanstack/react-virtual`(`useVirtualizer({horizontal: true})`)を新規導入**した。列幅は固定値(`VALUE_CELL_WIDTH`)。
  - 将来的に`react-virtuoso`を`@tanstack/react-virtual`に一本化し、Grid側もこちらに置き換えて仮想化ライブラリを1つにまとめたい意向があり、[Issue #8](https://github.com/mizulo-olmizu/data_viewer/issues/8)として登録した(今回のスコープ外)。
- セル範囲選択+コピー: Tableの`CellSelection`/`copySelection`等のロジックを`src/useCellRangeSelection.ts`という汎用フックに抽出し(動作は変えず、Table.tsx側もこのフックを使うようリファクタ)、GlimpseViewでも同じフックを軸を入れ替えて再利用した(縦軸=カラム、横軸=データ行)。コピー時のTSVは、Grid側が「ヘッダ行=列名、各行先頭=行番号」なのに対し、Glimpse側は転置して「ヘッダ行=行番号、各行先頭=列名」にした。
- 行のD&D並び替え・Pin: GridのD&D(`dnd-kit`、水平方向)と対称に、Glimpseでは各行(=カラム)を垂直方向にD&Dできるようにした。`table.setColumnOrder`/`table.setColumnPinning`をGlimpseView側から直接呼ぶことで、Table.tsx側の`columnOrder`/`columnPinning`stateをそのまま更新し、Grid側の列D&D・Pinと完全に同じ状態を共有する。
- ハマりどころ:
  - **`position: sticky`を縦横同時にスクロールするコンテナ内で使うと、WKWebView(macOS Tauri)で描画が壊れる(一部の行が描画されない、固定されているはずの列/行がスクロールで一緒に動いてしまう)不具合が発生した。** 左上コーナー(Column/Type見出し)・上段(行番号ルーラー)・左段(カラム名/型)を固定表示するために最初`position: sticky`を使ったが、値エリアが横(仮想化)・縦(多カラム時)の両方にスクロールしうる構成だと再現した。**stickyには頼らず、「値エリア(縦横スクロールの唯一のマスター)のスクロールイベントを起点に、固定パネル側の`scrollLeft`/`scrollTop`をJSで同期する」という昔ながらのフリーズペイン方式に書き直して解決した。**
  - **flexアイテムはデフォルトで`min-height: auto`のため、内容が多いと`flex-1`で意図した高さを無視して伸びてしまい、内部の`overflow-auto`が効かず縦スクロールできなくなった。** `min-h-0`を明示しても状況によっては不十分だったため、最終的にスクロールが必要な値エリア・左パネルは`flex-1`をやめて`position: absolute; inset: 0`(必要な辺のみ)で親の高さぴったりに固定する方式にした(`min-height:auto`問題を構造的に回避できる)。
  - **Pin(常時表示)の軸がGlimpseでは縦方向で、かつ縦方向がスクロール軸でもあるため、Grid同様のsticky的な固定はできない。** Pin中の行だけをスクロール領域の外(常時表示専用のセクション)に分離して描画する形にした。
  - **行番号ヘッダー(コピー時の列ラベル)に`tanstack-table`の`row.index`をそのまま使ったところ、フィルタ後は欠番が出て画面表示(仮想化アイテムの位置=連番)とズレるバグが起きた。** 一度「画面表示に合わせて連番にする」方向で直したが、レビューで「Grid側の`#`列表示(`row.index + 1`、フィルタで欠番があってもそのまま)に統一したい」という指摘を受け、画面上のルーラー表示側を`row.index`基準に合わせ直す形で決着した。GridとGlimpseで行番号の意味を完全に揃えるため。
  - **Pin列/通常列の境界線を`border-r`(通常のCSS border)で表現すると、`position: sticky`な要素ではスクロール中にWebKitが境界線を消してしまうことがあった。** `border`ではなく`box-shadow: 2px 0 0 0 var(--border)`で境界線を表現することで解決した(sticky要素の枠線がスクロール中に消えるのはWebKitの既知の描画不具合で、box-shadowに置き換えるのが定石の回避策)。GlimpseのPin境界線(スクロールしない領域のため`border-b-2`のまま)やType列の区切り線(`border-r`のまま)はスクロールに関与しないため影響を受けず、この対応は不要だった。
  - 列の並び替え・Pinを初期状態に戻す「Reset columns」ボタンをTableのツールバーに追加した(GlimpseとGrid両方に効く、共有stateを直接リセットするだけのため)。

### 1行表示(Record view) ✅ 対応済み(2026-07-22)
- 前提・課題: フェーズ1最後のタスク。Rの1レコード表示のように、1行分の全カラムを一覧できるビューを追加する。
- アーキテクチャ判断: Glimpseと同じく、Tableタブ内のサブビュー(Grid/Glimpse/Recordの3択タブ)として実装(`src/RecordView.tsx`)し、フィルタ・ソート・列の表示/非表示・並び替え・PinはTable側のstateをそのまま共有する。ただしGlimpseが表形式の転置ビューだったのに対し、Recordは「1画面になるべく多くの情報を詰め込みたい/表というより一覧性重視のカード形式にしたい」という要望から、`@tanstack/react-table`の行/列モデルではなく**フィールドごとのカード(CSS Grid、`rectSortingStrategy`でD&D並び替え)**として実装した。Pin/Sortボタンは(1レコードしか見えないため意味を持たないという判断で)持たないが、既存のPin状態自体はorderedColumnIds(Pin列が先頭)に反映され、カードの並び替えもPin/非Pinのグループを跨がないようにしている(Grid/Glimpseと同じ制約)。
- ナビゲーション: Prev/Next・スライダーでのスクラブ・ランダムジャンプ(現在と同じ位置は選ばれないよう補正)・行番号直接入力に対応。行番号は表示中(フィルタ・ソート後)の連番ではなく、**Gridの`#`列と同じ体系(元データの`row.index + 1`、フィルタで欠番があってもそのまま)**を採用し、画面をまたいでも同じ番号が同じレコードを指すようにした。行番号→位置の逆引きは`Map`で事前計算し(`rows`が変わった時だけ再計算)、大量行でもジャンプ操作はO(1)。
- キーボード操作: Vimライクな`j`/`k`と矢印キー(←/→)でPrev/Nextできる(neovim+ipython出身というユーザーの背景に合わせた)。テキスト入力・スライダーにフォーカスがある間はブラウザ標準の挙動を優先し、対象外にしている。
- 値の表示: Grid/Glimpseと違い幅の制約が無いため切り詰めない。NULLは空文字と区別するため専用バッジで明示。nested(struct/list/map)型のみ`JSON.stringify(value, null, 2)`でpretty-print、それ以外は生の値をそのまま表示する。
- コピー: カードごとの複数選択コピーは無し(1レコードしか無いため不要と判断)。カード右上のコピーアイコンでそのフィールドの値のみをクリップボードへコピーする。
- ハマりどころ:
  - **`ColumnInfo.columnType`はTS上`string`型と宣言されているが、実際はRustの`DuckDBType` enumがserdeのデフォルト(外部タグ形式)でそのままJSON化されたもので、STRUCT/LIST/MAP等はオブジェクト(例: `{"Struct": [...]}`)になる。** これを知らずにカードのType表示へ直接埋め込んだところ、nested型カラムを含むデータで「Objects are not valid as a React child」の実行時エラーになった。`Table.tsx`/`GlimpseView.tsx`は同じ問題を避けるため表示前に文字列化するガードを入れており、`RecordView.tsx`でも同様のガードを追加して解決した。調査の過程で、**同じ問題が`SummaryDisplay.tsx`(nested型が`columnSummary.type == "other"`分岐に入り、`columnInfo.columnType`を生オブジェクトのまま`SummaryCardContents`へ渡している)には残っており、nested型データを読み込むとSummary表示がクラッシュして画面が真っ白になることが判明した。** これは1行表示自体の不具合ではなく既存のバグのため、[Issue #10](https://github.com/mizulo-olmizu/data_viewer/issues/10)として切り出し、今回のスコープには含めていない。
  - **ランダムジャンプボタンは、単純に`Math.floor(Math.random() * rows.length)`だと現在の位置と同じ値を引くことがあり、見た目上「反応していない」ように見えた。** 同じ位置を引いた場合だけ`+1`して必ず別のレコードに移動するよう補正した。
  - **行番号ジャンプに失敗した(存在しない番号を入力した)際、`toast.error`だけでは気づきにくかった。** 入力欄に`aria-invalid`を立てて赤枠表示する形でフィードバックを強めたが、最初はPrev/Next・スライダー・ランダムなど「行番号入力欄を経由しない」操作でナビゲートしても赤枠が消えないままになる不具合を作り込んだ。ナビゲーション操作が最終的にすべて経由する共通関数`goTo`内で赤枠状態を解除するようにして解決(個別の操作ハンドラそれぞれに解除処理を書くのではなく、一箇所に集約するのが正解だった)。
  - **「現在位置 / 総件数」のようなカウンタ表示は、位置の桁数が変わる(例: 9→10)たびに幅が変わり、右側のスライダー・ランダムボタンがガタつく。** `rows.length`(総件数、ナビゲーション中は不変)の桁数を基準に`ch`単位で幅を固定し、`font-mono`+`tabular-nums`で桁ごとの幅を揃えることで解決。ただし`<span>`はデフォルト`display: inline`のため`width`が効かない点を見落としており、`inline-block`化して初めて機能した(`overflow-hidden`/`text-nowrap`も、理論上ははみ出さない計算だが念のため保険として追加)。同じ問題が既存の`ColumnVisibilityMenu`(「Columns」ボタン内の`{visibleCount}/{columns.length}`バッジ)にもあったため、同じ手法で合わせて修正した(Table/Summary両方のツールバーに効く共有コンポーネントのため)。

### データベースの永続化(Save/Open) ✅ 対応済み(2026-07-22)
- 前提・課題: フェーズ2最初のタスク。`DbState::save_database`はRust側に実装済みだったがコマンド化されておらずUIから呼べなかった。また起動時に永続DBを読み込む手段(CLI引数)も無かった。ユーザーとの相談の結果、対応スコープをTauri IPC(UI)のみに絞り(HTTP/CLIでの保存はフェーズ4の機能パリティ整備時に改めて検討)、加えて「開く」も対称的に実装する方針にした。
- 対応方針・実施内容:
  - `save_database`/`open_database`の2コマンドを`src-tauri/src/modules/handler.rs`に追加。`save_database`は`DbState::save_database`をそのまま呼ぶだけ、`open_database`は`DbState::try_new(Some(path))`で新しい接続を作り`AppData::dbstate`ごと差し替える(Mutexの中身を丸ごと再代入するだけで済み、既存のstate管理の仕組みに手を入れる必要は無かった)。
  - 上書き保存を許可するよう`db::save_database`を変更(既存ファイルがあれば`std::fs::remove_file`してからATTACH)。ネイティブのSaveダイアログで既存ファイル名を選ぶと「置き換えますか？」の確認が出るため、アプリ側もそれに合わせて上書きを許可する形にした。
  - 起動時の永続DB読み込みはCLI引数`-d/--db-path`で対応。`tauri_plugin_cli`はTauriの`App`インスタンスが無いと使えず、`AppData`の生成(`run()`冒頭、`.manage()`より前)には間に合わないため、single-instance再起動時のCLI引数パースと同じ方式(`MyArgs::try_parse_from(std::env::args())`で生のargvを直接パース)で`db_path`だけ先読みしている。指定したファイルが存在しない場合はDuckDBのデフォルト挙動(新規作成)をそのまま活かした。
  - single-instance再起動やHTTP経由で`--db-path`相当を渡しても、既存プロセスのDB接続を実行中に切り替えることはできないため無視する(`port`引数の既存の扱いと同じパターンで、ログにIgnoreした旨を出力するのみ)。
  - UIはサイドバーのDBパス表示横に「Database」という`DropdownMenu`を追加し、「New In-Memory Database」「Open Database...」「Save Database As...」の3項目を配置。Saveはin-memory時のみ有効(file-backedで開いている間は元から永続化されているため無効化)。
  - 初回実装後のレビューで「切り替え確認の粒度が粗い」「同じDBを選び直しても確認が出る」「Save後もin-memoryのままなのが直感に反する」というフィードバックを受け、以下のように作り直した:
    - `new_in_memory_database`コマンドを追加(`open_database`同様、`DbState::try_new(None)`で新しい接続に差し替えるだけ)。「メモリ上のDBに戻す/リセットする」ことを明示的な操作として扱う。
    - 切り替え確認は`AlertDialog`(今回新規追加、`radix-ui`の`AlertDialog`をラップ)を使い、現在の接続状態で内容を分岐させる: in-memory時は「Save & Switch(切替先とは別のパスへ退避してから切り替え)」「Switch without saving(破棄して切り替え)」「Cancel」の3択、file-backed時は(既に永続化済みでデータ消失リスクが無いため)「Switch」「Cancel」の2択。メモリ上にテーブルが1つも無い(`tableList.length === 0`)場合は、in-memoryに限り確認なしでそのまま切り替える。
    - Open Databaseで選んだファイルが現在開いているファイルと同じ場合は、確認ダイアログを出さずトースト通知のみで終える(`status.dbPath`との単純な文字列比較)。
    - 「Save Database As...」は、保存後にそのまま保存先ファイルを開いた状態に切り替わるようにした(`saveDatabase`→`openDatabase`を連続で呼ぶ)。ダイアログ内の「Save & Switch」は保存先とは別の切り替え先(選び直したファイル、または新規in-memory)へ移動するのが目的のため、あえて切り替えを伴わない生の`saveDatabase`のみを呼ぶ`onSaveDatabaseCopy`という別ハンドラを用意して区別した。
    - DBパス表示(`truncate`で省略されうる)に`Tooltip`を追加し、hoverでフルパスを確認できるようにした。
- ハマりどころ:
  - **`COPY FROM DATABASE (SELECT current_catalog()) TO {file_stem}`という既存のSQLが、実際にはDuckDBの構文として不正だった。** `save_database`には元々テストが無く、UIからの呼び出し経路も存在しなかったため、このバグはコマンド化・テスト追加までずっと気づかれていなかった。`COPY FROM DATABASE`のsource_dbは識別子でありサブクエリを書けないため、先に`SELECT current_catalog()`をクエリで実行してカタログ名を取得し、`escape_sql_identifier`でエスケープしてから識別子としてSQL文字列に埋め込む形に修正した。
  - **`AlertDialogAction`はRadixの`Dialog.Close`をラップしているだけで、クリックすると(onClickの中身に関わらず)即座にダイアログを閉じる。** 「Save & Switch」はクリック後にネイティブの保存先選択ダイアログを開き、ユーザーがそこでキャンセルした場合は確認ダイアログを開いたままにしたかったため、`AlertDialogAction`ではなく開閉を完全に手動制御できる通常の`Button`(`onClick`内で`pendingSwitch`をリセットするタイミングを自分で決める)に置き換えて対応した。`AlertDialogCancel`(常に即座に閉じてよい)はそのまま使っている。
  - `buttonVariants`を`AlertDialogAction`/`AlertDialogCancel`から再利用しようと`button.tsx`から直接exportしたところ、ESLintの`react-refresh/only-export-components`に引っかかった(コンポーネント以外のexportをコンポーネントと同じファイルに置くとFast Refreshが効かなくなるため)。既存の`use-sidebar.ts`等と同じく、`src/components/ui/button-variants.ts`に切り出して解決。

## 未整理・検討中

（まだ方針が決まっていないこと、判断に迷っていること）

- DBファイルを指定しない場合に、メモリ上ではなく一時ファイルとして作成し終了時に削除する案。pythonなどとの連携がスムーズになるかもしれないが、必要性・実装コストともに未検討。
- [missingno](https://github.com/ResidentMario/missingno)のような、NULL値の分布・欠損パターンを可視化する機能。Table/Summaryと同階層の独立ビュー(新規タブ)にするか、Summary(要約表示)内に組み込むか未定。1行表示(Record view)実装時の動作確認中に着想したアイデアで、今回のスコープには含めていない。
