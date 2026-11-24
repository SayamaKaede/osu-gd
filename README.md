# osu!GD

**osu!GD は [osu! Kai](https://github.com/SayamaKaede/osu-kai) に統合しました。** osu! Kai をインストールしたら、osu!GD は削除してください。両方が入っている間は、osu! Kai の側が表示します。

osu! および ppy とは関係ありません。不具合が発生しても osu! 側に問い合わせないでください。

osu! のプロフィールページに、そのユーザーの Pending・Graveyard のゲスト難易度の譜面を表示する Tampermonkey スクリプトです。

osu! のプロフィールにあるゲスト難易度の一覧には、リーダーボードのあるカテゴリ（Ranked・Approved・Qualified・Loved）の譜面しか表示されません。Pending や Graveyard の譜面にあるゲスト難易度は、どこにも表示されません。このスクリプトはそれを取得して、プロフィールに2つの欄として表示します。

modding タブの円グラフにも、この2つの情報を追加します。
## インストール

1. ブラウザに [Tampermonkey](https://www.tampermonkey.net/) をインストールする
2. **[osu-gd.user.js](https://raw.githubusercontent.com/SayamaKaede/osu-gd/main/osu-gd.user.js) を開く**

2 のリンクを開くと、Tampermonkey のインストール画面が表示されます。

自動更新に対応しています。

## ライセンス

MIT。詳しくは [LICENSE](LICENSE) を参照してください。
