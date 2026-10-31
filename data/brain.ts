/**
 * MY BRAIN の中身。
 * ここを書き換えるだけで、脳内のワード・色・つながり・QR が更新される。
 */

export interface BrainWord {
  label: string
  /** さらに細かいワード (このワードの周りに浮かぶ) */
  words?: BrainWordInput[]
  /** ワードの代わりに、この URL の QR コードを表示する */
  qr?: string
}
/** ワードは文字列だけでも、入れ子のオブジェクトでも書ける */
export type BrainWordInput = string | BrainWord

export interface BrainCategory {
  id: string
  label: string
  color: string
  /**
   * 脳のどのあたりに置くか (脳ローカル座標: x=左右 / y=上下 / z=前後, +z が前)。
   * 表面付近を指定すると、自動で内側に寄せて配置される。
   */
  region: [number, number, number]
  /** このカテゴリーの周りに浮かぶワード (脳全体で同じワードを2回使わないように) */
  words: BrainWordInput[]
}

/** 脳の真ん中にいる人 */
export const profile = {
  name: 'ぎる',
  nameEn: 'GIL',
}

/** 作品紹介 (脳内の「QR」が指す作品) */
export const featuredWork = {
  title: 'Weekly Works Tower',
  url: 'https://gil0304.github.io/weekly-works-tower/',
}

export const brainData: BrainCategory[] = [
  {
    id: 'music',
    label: '音楽',
    color: '#FF4FA3',
    region: [1.08, -0.42, 0.18],
    words: ['SUPER BEAVER', 'tuki.', 'aespa'],
  },
  {
    id: 'programming',
    label: 'プログラミング',
    color: '#00DFFF',
    region: [-0.72, 0.62, 0.82],
    words: ['WebS', 'WebD', 'iPhone', 'Android'],
  },
  {
    id: 'sports',
    label: 'スポーツ',
    color: '#FF7A3C',
    region: [0.6, 0.86, 0.02],
    words: ['バスケ', 'スノボ', '野球'],
  },
  {
    id: 'hobby',
    label: '趣味',
    color: '#3DFF9A',
    region: [-1.08, -0.4, -0.12],
    words: ['サウナ'],
  },
  {
    id: 'anime',
    label: 'アニメ',
    color: '#A66BFF',
    region: [-0.3, 0.32, -1.38],
    words: ['NARUTO'],
  },
  {
    id: 'likes',
    label: '好きなこと',
    color: '#FFD95A',
    region: [0.32, -0.04, 1.36],
    words: [
      {
        label: 'ものづくり',
        words: ['前期60', { label: 'QR', qr: featuredWork.url }],
      },
    ],
  },
]

/**
 * カテゴリーをまたぐつながり (ワード または カテゴリーの id を指定)。弧の線で表示される。
 * 例: ['iPhone', 'SUPER BEAVER'] と書くと、プログラミングと音楽の間に線が引かれる。
 */
export const brainLinks: [string, string][] = [['ものづくり', 'programming']]
