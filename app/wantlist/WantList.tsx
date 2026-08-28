"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import styles from "./wantlist.module.css";

// Note: the internal set code is deliberately NOT part of this shape. It is an
// internal identifier, so it is stripped from the published data rather than
// merely hidden - otherwise it would still be readable in the page source.
export type Card = {
  i: number; setName: string; year: string; num: string;
  jp: string; en: string; rar: string; c: boolean; img: string | null;
};

const STORE_KEY = "wantlist.checked.v1";

// Two renditions per card: a 128px thumbnail for the grid (683 of them load on
// one page, so weight matters) and a 420px copy the lightbox opens on demand.
const full = (img: string) => `/wantlist/${img}`;
const thumb = (img: string) => `/wantlist/${img.replace(/\.webp$/, "-t.webp")}`;

function haystack(c: Card) {
  return `${c.setName} ${c.num} ${c.jp} ${c.en} ${c.rar}`.toLowerCase();
}

export default function WantList({ cards, updated }: { cards: Card[]; updated: string }) {
  const [q, setQ] = useState("");
  const [checked, setChecked] = useState<Record<number, true>>({});
  const [zoom, setZoom] = useState<Card | null>(null);

  // Per-viewer convenience only; a private window or blocked storage must not
  // break the page, so every access is guarded.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) setChecked(JSON.parse(raw) ?? {});
    } catch {
      /* storage unavailable - page still works */
    }
  }, []);
  const persist = useCallback((next: Record<number, true>) => {
    setChecked(next);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const index = useMemo(() => cards.map(haystack), [cards]);
  const term = q.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!term) return cards;
    return cards.filter((_, n) => index[n].includes(term));
  }, [cards, index, term]);

  const groups = useMemo(() => {
    const out: { setName: string; year: string; items: Card[] }[] = [];
    for (const c of visible) {
      const last = out[out.length - 1];
      if (last && last.setName === c.setName && last.year === c.year) last.items.push(c);
      else out.push({ setName: c.setName, year: c.year, items: [c] });
    }
    return out;
  }, [visible]);

  const doneCount = Object.keys(checked).length;
  const crank = useMemo(() => cards.filter((c) => c.c).length, [cards]);
  const setCount = useMemo(
    () => new Set(cards.map((c) => `${c.setName}|${c.year}`)).size,
    [cards],
  );

  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setZoom(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);

  return (
    <div className={styles.page}>
      <div className={styles.wrap}>
        <header className={styles.mast}>
          <p className={styles.kicker}>継続買付リスト / standing list</p>
          <h1 className={styles.title}>
            仕入希望カードリスト
            <span className={styles.titleEn}>Japan Singles Want List</span>
          </h1>
          <p className={styles.lede}>
            日本国内で探していただきたいシングルカードの一覧です。画像をタップすると拡大表示されます。
          </p>
          <div className={styles.stats}>
            <div className={styles.stat}><b>{cards.length}</b><span>種類 titles</span></div>
            <div className={styles.stat}><b>{setCount}</b><span>セット sets</span></div>
            <div className={styles.stat}><b>{crank}</b><span>Cランク可 C-rank ok</span></div>
          </div>
          <p className={styles.cond}>
            <b>状態について</b>
            基本はBランク以上でお願いします。ただし <span className={styles.condTag}>Cランク可</span> の表示があるカードに限り、Cランク・プレイ用でも歓迎します。
          </p>
          <div className={styles.note}>
            <h3>ご確認いただきたい点</h3>
            <ul>
              <li>随時更新する継続リストです。入荷があった際に、その都度ご連絡いただけると助かります。</li>
              <li>新しいセットのカードは状態が価格に直結するため、Cランク以下は見送らせてください。</li>
            </ul>
          </div>
        </header>

        <div className={styles.bar}>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="カード名・セット名・型番で検索 / search"
            aria-label="検索 search"
          />
          <span className={styles.prog}><b>{doneCount}</b> / {cards.length} 確認済</span>
          <button type="button" onClick={() => persist({})}>チェックを消す</button>
        </div>

        <main>
          {groups.map((g) => (
            <section key={`${g.setName}|${g.year}`} className={styles.set}>
              <h2 className={styles.sethead}>
                <span className={styles.setname}>{g.setName}</span>
                <span className={styles.setyear}>{g.year}</span>
                <span className={styles.setqty}>{g.items.length} 種</span>
              </h2>
              <div className={styles.rows}>
                {g.items.map((c) => (
                  <div key={c.i} className={`${styles.row} ${checked[c.i] ? styles.done : ""}`}>
                    <label className={styles.tick}>
                      <input
                        type="checkbox"
                        className={styles.chk}
                        checked={!!checked[c.i]}
                        aria-label={`${c.jp} 確認済にする`}
                        onChange={(e) => {
                          const next = { ...checked };
                          if (e.target.checked) next[c.i] = true;
                          else delete next[c.i];
                          persist(next);
                        }}
                      />
                    </label>
                    {c.img ? (
                      <button type="button" className={styles.zoom} onClick={() => setZoom(c)}
                        aria-label={`拡大 ${c.jp} ${c.en}`}>
                        <img className={styles.pic} src={thumb(c.img)} alt="" loading="lazy" decoding="async" />
                      </button>
                    ) : (
                      <span className={styles.picNone} aria-hidden="true" />
                    )}
                    <label className={styles.meta}>
                      <span className={styles.num}>{c.num}</span>
                      <span className={styles.nm}>
                        <span className={styles.jp}>{c.jp}</span>
                        <span className={styles.en}>{c.en}</span>
                        {c.rar && <span className={styles.rar}>{c.rar}</span>}
                        {c.c && <span className={styles.played}>Cランク可</span>}
                      </span>
                    </label>
                  </div>
                ))}
              </div>
            </section>
          ))}
          {groups.length === 0 && <p className={styles.empty}>該当するカードがありません</p>}
        </main>

        <footer className={styles.footer}>
          <span>価格未定・要お見積り / Prices to be quoted</span>
          <span>UPDATED {updated}</span>
        </footer>
      </div>

      {zoom && (
        <div className={styles.lb} role="dialog" aria-modal="true" aria-label="カード画像"
             onClick={(e) => { if (e.target === e.currentTarget) setZoom(null); }}>
          <button type="button" className={styles.lbClose} onClick={() => setZoom(null)} aria-label="閉じる">&times;</button>
          <figure>
            <img src={full(zoom.img!)} alt={`${zoom.jp} ${zoom.en}`} />
            <figcaption>
              <b>{zoom.jp} {zoom.en}</b>
              {zoom.setName} {zoom.num}
            </figcaption>
          </figure>
        </div>
      )}
    </div>
  );
}
