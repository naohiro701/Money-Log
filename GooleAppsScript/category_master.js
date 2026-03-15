/**
 * 家計カテゴリの 3 階層マスタ。
 * LINE 手入力と OCR 結果の両方で同じカテゴリ体系を使うため、定義を一箇所に集約している。
 */
var CATEGORY_TREE_V3 = {
  "生活費(食住)": {
    "食費": ["食料品", "外食", "朝ご飯", "昼ご飯", "夜ご飯"],
    "日用品": ["日用品", "子育て用品", "ドラッグストア"],
    "住宅": ["住宅家賃・地代", "ローン返済", "管理費・積立金"],
    "水道・光熱費": ["光熱費", "電気代", "ガス・灯油代", "水道代"],
    "通信費": ["携帯電話", "固定電話", "インターネット"],
    "その他出費": ["仕送り", "事業経費", "事業原価"]
  },
  "もの支出(娯楽・自己投資)": {
    "交際費": ["お土産", "飲み会", "プレゼント", "冠婚葬祭", "その他"],
    "教養・教育": ["新聞・雑誌", "習いごと", "学費"],
    "衣服": ["衣服", "クリーニング"]
  },
  "こと支出(移動等)": {
    "身体関連": ["フィットネス", "医療費", "ボデイケア", "美容院・理髪"],
    "趣味・娯楽": ["アウトドア", "ゴルフ", "スポーツ", "映画・音楽・ゲーム"],
    "移動費": ["ホテル", "電車", "バス", "タクシー", "飛行機"],
    "特別な支出": ["家具・家電", "住宅・リフォーム"]
  },
  "保留": {
    "未分類": ["未分類"]
  }
};

/**
 * OCR でカテゴリが取れない場合や、入力値がマスタに存在しない場合の既定値。
 */
var CATEGORY_FALLBACK_V3 = {
  main: "保留",
  sub: "未分類",
  detail: "未分類"
};

/**
 * 大分類の一覧を返す。
 *
 * Input: なし
 * Output:
 * - `["生活費(食住)", ...]`
 */
function getMainCategories_() {
  return Object.keys(CATEGORY_TREE_V3);
}

/**
 * 指定した大分類に属する中分類一覧を返す。
 *
 * Input:
 * - `mainCategory`: 大分類名
 *
 * Output:
 * - 中分類配列
 */
function getSubCategories_(mainCategory) {
  return CATEGORY_TREE_V3[mainCategory] ? Object.keys(CATEGORY_TREE_V3[mainCategory]) : [];
}

/**
 * 指定した大分類・中分類に属する小分類一覧を返す。
 *
 * Input:
 * - `mainCategory`: 大分類名
 * - `subCategory`: 中分類名
 *
 * Output:
 * - 小分類配列
 */
function getDetailCategories_(mainCategory, subCategory) {
  if (!CATEGORY_TREE_V3[mainCategory]) return [];
  return CATEGORY_TREE_V3[mainCategory][subCategory] || [];
}

/**
 * 任意のカテゴリ文字列から、3階層のカテゴリパスを決定する。
 * OCR では大分類だけ、中分類だけ、小分類だけ返る場合があるため、
 * どの階層の値が来ても保存用の `{main, sub, detail}` に正規化する。
 *
 * Input:
 * - `rawValue`: OCR または更新 API から渡されたカテゴリ文字列
 *
 * Output:
 * - `{ main, sub, detail }`
 */
function resolveCategoryPath_(rawValue) {
  var normalized = trimString_(rawValue);
  if (!normalized) return CATEGORY_FALLBACK_V3;

  var mainCategories = getMainCategories_();
  for (var i = 0; i < mainCategories.length; i++) {
    var mainCategory = mainCategories[i];
    if (mainCategory === normalized) {
      var subCategories = getSubCategories_(mainCategory);
      var fallbackSub = subCategories[0] || CATEGORY_FALLBACK_V3.sub;
      var fallbackDetail = getDetailCategories_(mainCategory, fallbackSub)[0] || CATEGORY_FALLBACK_V3.detail;
      return {
        main: mainCategory,
        sub: fallbackSub,
        detail: fallbackDetail
      };
    }

    var subCategoriesForMain = getSubCategories_(mainCategory);
    for (var j = 0; j < subCategoriesForMain.length; j++) {
      var subCategory = subCategoriesForMain[j];
      if (subCategory === normalized) {
        return {
          main: mainCategory,
          sub: subCategory,
          detail: getDetailCategories_(mainCategory, subCategory)[0] || CATEGORY_FALLBACK_V3.detail
        };
      }

      var detailCategories = getDetailCategories_(mainCategory, subCategory);
      for (var k = 0; k < detailCategories.length; k++) {
        if (detailCategories[k] === normalized) {
          return {
            main: mainCategory,
            sub: subCategory,
            detail: detailCategories[k]
          };
        }
      }
    }
  }

  return CATEGORY_FALLBACK_V3;
}
