import { afterAll, describe, expect, it } from "vitest";
import {
  startInspection, setItem, completeInspection, sendInspection, getInspection,
  getInspectionByToken, createTemplate, ensureDefaultTemplate, listTemplates,
  summarise, groupItems, DEFAULT_TEMPLATE, InspectionError,
} from "@/lib/inspections";
import { estimateToRepairOrder } from "@/lib/convert";
import { makeShop, makeEstimate, testDb } from "./helpers";

const db = testDb();
afterAll(async () => { await db.$disconnect(); });

async function makeRO() {
  const shop = await makeShop(db);
  const est = await makeEstimate(db, shop, [{ kind: "LABOR", name: "Service", priceCents: 9_900 }]);
  const ro = await estimateToRepairOrder(db, { estimateId: est.id });
  return { shop, ro };
}

describe("templates", () => {
  it("gives a new shop the default checklist rather than an empty screen", async () => {
    const shop = await makeShop(db);
    const template = await ensureDefaultTemplate(shop.tenant.id);

    expect(template.name).toBe("Multi-point inspection");
    expect(JSON.parse(template.itemsJson)).toHaveLength(DEFAULT_TEMPLATE.length);
  });

  it("does not create a second default once a shop has one", async () => {
    const shop = await makeShop(db);
    await ensureDefaultTemplate(shop.tenant.id);
    await ensureDefaultTemplate(shop.tenant.id);

    expect(await listTemplates(shop.tenant.id)).toHaveLength(1);
  });

  it("rejects a template with no name or no items", async () => {
    const shop = await makeShop(db);
    await expect(createTemplate(shop.tenant.id, { name: " ", items: DEFAULT_TEMPLATE }))
      .rejects.toThrow(/give the template a name/i);
    await expect(createTemplate(shop.tenant.id, { name: "Empty", items: [] }))
      .rejects.toThrow(/at least one item/);
  });
});

describe("running an inspection", () => {
  it("copies the template's items onto the result", async () => {
    const { shop, ro } = await makeRO();
    const result = await startInspection(shop.tenant.id, ro.id);

    const full = await getInspection(shop.tenant.id, result.id);
    expect(full!.items).toHaveLength(DEFAULT_TEMPLATE.length);
    expect(full!.items[0].label).toBe(DEFAULT_TEMPLATE[0].label);
    expect(full!.items[0].section).toBe(DEFAULT_TEMPLATE[0].section);
    expect(full!.items.every((i) => i.condition === "NA")).toBe(true);
  });

  it("does not rewrite an inspection when the template changes later", async () => {
    const { shop, ro } = await makeRO();
    const template = await createTemplate(shop.tenant.id, {
      name: "Quick check", items: [{ section: "Tires", label: "Tread depth" }],
    });
    const result = await startInspection(shop.tenant.id, ro.id, { templateId: template.id });

    await db.inspectionTemplate.update({
      where: { id: template.id },
      data: { itemsJson: JSON.stringify([{ section: "Tires", label: "Something else entirely" }]) },
    });

    const full = await getInspection(shop.tenant.id, result.id);
    expect(full!.items[0].label).toBe("Tread depth");
  });

  it("accepts a template written as a plain list of strings", async () => {
    const { shop, ro } = await makeRO();
    const template = await db.inspectionTemplate.create({
      data: { tenantId: shop.tenant.id, name: "Hand typed", itemsJson: JSON.stringify(["Wipers", "Lights"]) },
    });
    const result = await startInspection(shop.tenant.id, ro.id, { templateId: template.id });

    const full = await getInspection(shop.tenant.id, result.id);
    expect(full!.items.map((i) => i.label)).toEqual(["Wipers", "Lights"]);
    expect(full!.items[0].section).toBe("Inspection");
  });

  it("marks an item and keeps the note", async () => {
    const { shop, ro } = await makeRO();
    const result = await startInspection(shop.tenant.id, ro.id);
    const full = await getInspection(shop.tenant.id, result.id);

    const marked = await setItem(shop.tenant.id, full!.items[0].id, {
      condition: "RED", notes: "2/32 — needs replacing",
    });
    expect(marked.condition).toBe("RED");
    expect(marked.notes).toBe("2/32 — needs replacing");
  });

  it("will not let one shop mark another's inspection", async () => {
    const { shop, ro } = await makeRO();
    const other = await makeShop(db);
    const result = await startInspection(shop.tenant.id, ro.id);
    const full = await getInspection(shop.tenant.id, result.id);

    await expect(setItem(other.tenant.id, full!.items[0].id, { condition: "GREEN" }))
      .rejects.toThrow(/no longer exists/);
  });

  it("refuses to start on another shop's repair order", async () => {
    const { ro } = await makeRO();
    const other = await makeShop(db);
    await expect(startInspection(other.tenant.id, ro.id)).rejects.toThrow(/no longer exists/);
  });

  it("counts what was found", async () => {
    expect(summarise([
      { condition: "GREEN" as const }, { condition: "GREEN" as const },
      { condition: "RED" as const }, { condition: "NA" as const },
    ])).toEqual({ GREEN: 2, YELLOW: 0, RED: 1, NA: 1, checked: 3, total: 4 });
  });

  it("groups items the way a customer reads them", async () => {
    const groups = groupItems([
      { section: "Brakes", label: "Front", sort: 1 },
      { section: "Tires", label: "LF", sort: 0 },
      { section: "Brakes", label: "Rear", sort: 2 },
    ] as { section: string | null; sort: number; label: string }[]);

    expect(groups.map((g) => g.section)).toEqual(["Brakes", "Tires"]);
    expect(groups[0].items.map((i) => i.label)).toEqual(["Front", "Rear"]);
  });
});

describe("finishing and sending", () => {
  async function markedInspection() {
    const { shop, ro } = await makeRO();
    const result = await startInspection(shop.tenant.id, ro.id);
    const full = await getInspection(shop.tenant.id, result.id);
    await setItem(shop.tenant.id, full!.items[0].id, { condition: "RED", notes: "2/32" });
    await setItem(shop.tenant.id, full!.items[1].id, { condition: "GREEN" });
    return { shop, ro, result };
  }

  it("refuses to finish an inspection nobody has filled in", async () => {
    const { shop, ro } = await makeRO();
    const result = await startInspection(shop.tenant.id, ro.id);

    await expect(completeInspection(shop.tenant.id, result.id)).rejects.toThrow(/at least one item/);
    await expect(sendInspection(shop.tenant.id, result.id)).rejects.toThrow(/at least one item/);
  });

  it("has no reachable URL until it is sent", async () => {
    const { shop, result } = await markedInspection();
    await completeInspection(shop.tenant.id, result.id);

    const stored = await db.inspectionResult.findUniqueOrThrow({ where: { id: result.id } });
    expect(stored.status).toBe("COMPLETE");
    expect(stored.shareToken).toBeNull();
  });

  it("mints a token on send and serves it to the customer", async () => {
    const { shop, result } = await markedInspection();
    const { token, channel } = await sendInspection(shop.tenant.id, result.id);

    expect(token).toHaveLength(32);
    expect(channel).toBe("SMS");

    const seen = await getInspectionByToken(token);
    expect(seen).not.toBeNull();
    expect(seen!.items.find((i) => i.condition === "RED")?.notes).toBe("2/32");
    expect(seen!.repairOrder.customer.firstName).toBe("Dana");
  });

  it("records what it told the customer, and says how bad it was", async () => {
    const { shop, result } = await markedInspection();
    await sendInspection(shop.tenant.id, result.id);

    const message = await db.message.findFirstOrThrow({
      where: { tenantId: shop.tenant.id, template: "inspection_ready" },
    });
    expect(message.body).toContain("1 item needs attention");
    expect(message.status).toBe("QUEUED");
  });

  it("says everything looks good when it does", async () => {
    const { shop, ro } = await makeRO();
    const result = await startInspection(shop.tenant.id, ro.id);
    const full = await getInspection(shop.tenant.id, result.id);
    await setItem(shop.tenant.id, full!.items[0].id, { condition: "GREEN" });
    await sendInspection(shop.tenant.id, result.id);

    const message = await db.message.findFirstOrThrow({
      where: { tenantId: shop.tenant.id, template: "inspection_ready" },
    });
    expect(message.body).toContain("everything looks good");
  });

  it("honours an opt-out rather than messaging anyway", async () => {
    const { shop, result } = await markedInspection();
    await db.customer.update({
      where: { id: shop.customer.id },
      data: { smsOptOut: true, emailOptOut: true },
    });

    const { channel } = await sendInspection(shop.tenant.id, result.id);
    expect(channel).toBeNull();
    expect(await db.message.count({ where: { tenantId: shop.tenant.id, template: "inspection_ready" } })).toBe(0);
  });

  it("freezes a sent inspection", async () => {
    const { shop, result } = await markedInspection();
    await sendInspection(shop.tenant.id, result.id);
    const full = await getInspection(shop.tenant.id, result.id);

    await expect(setItem(shop.tenant.id, full!.items[2].id, { condition: "GREEN" }))
      .rejects.toThrow(/already been sent/);
  });

  it("keeps the same link when it is sent twice", async () => {
    const { shop, result } = await markedInspection();
    const first = await sendInspection(shop.tenant.id, result.id);
    const second = await sendInspection(shop.tenant.id, result.id);

    expect(second.token).toBe(first.token);
  });

  it("returns nothing for a token that was never issued", async () => {
    expect(await getInspectionByToken("not-a-real-token")).toBeNull();
    expect(await getInspectionByToken("")).toBeNull();
  });
});
