import { describe, expect, it } from "vitest";
import { parseCsv, detectColumns, parseCollectionRows } from "./tcgplayer-collection-csv";
import { numberCore, matchCollectionRow, type MatchableHolding } from "./tcgplayer-collection-match";

const HEADER = "Quantity,Name,Set,Card Number,Condition,Printing,Price";
const SAMPLE = [
  HEADER,
  '2,Charizard,Base Set,4/102,Near Mint,Holofoil,"$1,200.00"',
  '1,"Pikachu, Full Art",SV1a,006,Lightly Played,Normal,$40.50',
  ",,,,,,", // blank-ish row, dropped (no name)
].join("\n");

describe("tcgplayer collection CSV parsing", () => {
  it("detects columns by fuzzy header, ignoring order/spelling", () => {
    const header = parseCsv(HEADER)[0];
    const map = detectColumns(header);
    expect(map.quantity).toBe(0);
    expect(map.name).toBe(1);
    expect(map.set).toBe(2);
    expect(map.number).toBe(3);
    expect(map.condition).toBe(4);
    expect(map.printing).toBe(5);
    expect(map.price).toBe(6);
  });

  it("does not let 'Set' claim the 'Card Number' column", () => {
    const map = detectColumns(["Set Name", "Card Number", "Qty", "Product Name", "Price"]);
    expect(map.set).toBe(0);
    expect(map.number).toBe(1);
    expect(map.quantity).toBe(2);
    expect(map.name).toBe(3);
    expect(map.price).toBe(4);
  });

  it("parses rows: money, quantity, and drops nameless lines", () => {
    const matrix = parseCsv(SAMPLE);
    const rows = parseCollectionRows(matrix, detectColumns(matrix[0]));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: "Charizard", number: "4/102", quantity: 2, priceUsd: 1200 });
    expect(rows[1]).toMatchObject({ name: "Pikachu, Full Art", number: "006", quantity: 1, priceUsd: 40.5 });
  });
});

describe("numberCore", () => {
  it("reduces to a comparable core", () => {
    expect(numberCore("006")).toBe("6");
    expect(numberCore("6/102")).toBe("6");
    expect(numberCore("052/SV-P")).toBe("52");
    expect(numberCore(" 4/102 ")).toBe("4");
    expect(numberCore(null)).toBe("");
    expect(numberCore("")).toBe("");
  });
});

describe("matchCollectionRow", () => {
  const holding = (over: Partial<MatchableHolding>): MatchableHolding => ({
    key: "k", card_id: 1, set_code: "BASE", card_number: "4/102",
    name: "リザードン", englishName: "Charizard", leg: "export", qty_on_hand: 3, ...over,
  });
  const row = { rowIndex: 1, name: "Charizard", set: "Base", number: "4/102", condition: "NM", printing: "Holofoil", quantity: 1, priceUsd: 100 };

  it("matches a unique number", () => {
    const m = matchCollectionRow(row, [holding({ key: "a" })]);
    expect(m.status).toBe("matched");
    expect(m.holding?.key).toBe("a");
  });

  it("reports none when no holding carries the number", () => {
    expect(matchCollectionRow({ ...row, number: "999" }, [holding({})]).status).toBe("none");
  });

  it("ignores a number match with zero on hand", () => {
    expect(matchCollectionRow(row, [holding({ qty_on_hand: 0 })]).status).toBe("none");
  });

  it("breaks a number tie by name agreement", () => {
    const m = matchCollectionRow(row, [
      holding({ key: "chariz", englishName: "Charizard" }),
      holding({ key: "blastoise", englishName: "Blastoise", name: "カメックス" }),
    ]);
    expect(m.status).toBe("matched");
    expect(m.holding?.key).toBe("chariz");
  });

  it("is ambiguous when the number ties and names don't disambiguate", () => {
    const m = matchCollectionRow({ ...row, name: "Mystery" }, [
      holding({ key: "a" }), holding({ key: "b" }),
    ]);
    expect(m.status).toBe("ambiguous");
    expect(m.candidates).toHaveLength(2);
    expect(m.holding).toBeNull();
  });
});
