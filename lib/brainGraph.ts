/**
 * data/brain.ts から「意味のあるノード」(中心・カテゴリー・ワード) と
 * そのつながりを組み立てる。three.js には依存しない。
 */
import { brainData, brainLinks, profile, type BrainCategory, type BrainWordInput } from '~/data/brain'

export const CORE_ID = 'core'
export const CORE_COLOR = '#EAF2FF'

export type GraphNodeKind = 'core' | 'category' | 'child'

export interface GraphNode {
  /** カテゴリーは id、ワードはワードそのもの */
  id: string
  kind: GraphNodeKind
  label: string
  color: string
  /** 0 始まりのカテゴリー番号 (core は -1) */
  categoryIndex: number
  /** 中心=0, カテゴリー=1, ワード=2, 入れ子のワード=3… */
  depth: number
  region?: [number, number, number]
  /** ワードの代わりに表示する QR コードの URL */
  qr: string | null
  parentId: string | null
  childIds: string[]
  /** カテゴリーをまたぐつながり */
  links: string[]
}

export interface GraphEdge {
  a: string
  b: string
  kind: 'core' | 'tree' | 'link'
}

export interface BrainGraph {
  nodes: GraphNode[]
  byId: Map<string, GraphNode>
  edges: GraphEdge[]
  categories: GraphNode[]
  /** 選択時に一緒に強調するノード */
  related(id: string): string[]
}

export function buildBrainGraph(categories: BrainCategory[] = brainData, links: [string, string][] = brainLinks): BrainGraph {
  const nodes: GraphNode[] = []
  const byId = new Map<string, GraphNode>()
  const edges: GraphEdge[] = []

  const add = (node: GraphNode) => {
    if (byId.has(node.id)) console.warn(`[brain] 同じワードが2回使われています: ${node.id}`)
    nodes.push(node)
    byId.set(node.id, node)
    return node
  }

  const core = add({
    id: CORE_ID,
    kind: 'core',
    label: profile.name,
    color: CORE_COLOR,
    categoryIndex: -1,
    depth: 0,
    qr: null,
    parentId: null,
    childIds: [],
    links: [],
  })

  const addWord = (input: BrainWordInput, parent: GraphNode) => {
    const word = typeof input === 'string' ? { label: input } : input
    const node = add({
      id: word.label,
      kind: 'child',
      label: word.label,
      color: parent.color,
      categoryIndex: parent.categoryIndex,
      depth: parent.depth + 1,
      qr: word.qr ?? null,
      parentId: parent.id,
      childIds: [],
      links: [],
    })
    parent.childIds.push(node.id)
    edges.push({ a: parent.id, b: node.id, kind: 'tree' })
    word.words?.forEach((w) => addWord(w, node))
  }

  categories.forEach((cat, ci) => {
    const node = add({
      id: cat.id,
      kind: 'category',
      label: cat.label,
      color: cat.color,
      categoryIndex: ci,
      depth: 1,
      region: cat.region,
      qr: null,
      parentId: CORE_ID,
      childIds: [],
      links: [],
    })
    core.childIds.push(node.id)
    edges.push({ a: CORE_ID, b: cat.id, kind: 'core' })
    cat.words.forEach((w) => addWord(w, node))
  })

  for (const [from, to] of links) {
    const a = byId.get(from)
    const b = byId.get(to)
    if (!a || !b) {
      console.warn(`[brain] 見つからないワードへのつながり: ${from} -> ${to}`)
      continue
    }
    a.links.push(b.id)
    b.links.push(a.id)
    edges.push({ a: a.id, b: b.id, kind: 'link' })
  }

  const descendants = (node: GraphNode, set: Set<string>) => {
    for (const cid of node.childIds) {
      set.add(cid)
      const child = byId.get(cid)!
      child.links.forEach((l) => set.add(l))
      descendants(child, set)
    }
  }

  const related = (id: string): string[] => {
    const node = byId.get(id)
    if (!node) return []
    const set = new Set<string>([id])
    if (node.kind === 'core') {
      node.childIds.forEach((c) => set.add(c))
      return [...set]
    }
    if (node.parentId) set.add(node.parentId)
    node.links.forEach((l) => set.add(l))
    descendants(node, set)
    return [...set]
  }

  return {
    nodes,
    byId,
    edges,
    categories: nodes.filter((n) => n.kind === 'category'),
    related,
  }
}

/** アプリ全体で共有するグラフ (データは静的なので1回だけ組み立てる) */
export const brainGraph = buildBrainGraph()
