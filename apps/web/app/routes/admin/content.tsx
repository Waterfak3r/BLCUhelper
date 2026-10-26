import { SITE } from "@aihot/site";
import { CATEGORY_KEYS, CATEGORY_LABELS } from "@aihot/contracts/taxonomy";
import { Form, Link, useNavigate, useSearchParams } from "react-router";
import type { Route } from "./+types/content";
import type { AdminContentRow, AdminContentSearch } from "@aihot/contracts/admin";
import { adminGet } from "../../lib/admin.server";
import { VISIBILITY_LABEL } from "../../features/admin/labels";
import { AdminPage, Badge, Button, Card, DataTable, Empty, Field, Input, Select, Time } from "../../features/admin/ui";


export async function loader({ request }: Route.LoaderArgs) {
  const searchParams = new URL(request.url).searchParams;
  const q = searchParams.get("q")?.trim() ?? "";
  const category = CATEGORY_KEYS.find((key) => key === searchParams.get("category")) ?? "";
  if (!q && !category) return { q, category, rows: [] as AdminContentRow[] };
  const params = new URLSearchParams({ q });
  if (category) params.set("category", category);
  const { rows } = await adminGet<AdminContentSearch>(request, `/api/admin/content?${params}`);
  return { q, category, rows };
}

export const meta: Route.MetaFunction = () => [{ title: `内容诊断 · ${SITE.name} 后台` }];

export default function Content({ loaderData }: Route.ComponentProps) {
  const { q, category, rows } = loaderData;
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  return (
    <AdminPage title="内容诊断" subtitle="按 ID、原文链接或标题找到任何一条内容，看它从信源到公开出口的完整链路；下架、仅摘要、人工修正和重处理都在详情页。">
      <Form method="get" className="mb-5 grid max-w-3xl items-end gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)_auto]">
        <Input className="min-w-0" name="q" defaultValue={sp.get("q") ?? ""} placeholder="内容 ID、URL 或标题关键词" aria-label="搜索内容" autoFocus />
        <Field label="类别">
          <Select key={category} name="category" defaultValue={category} aria-label="类别" className="min-w-0">
            <option value="">全部类别</option>
            {CATEGORY_KEYS.map((key) => <option key={key} value={key}>{CATEGORY_LABELS[key]}</option>)}
          </Select>
        </Field>
        <Button type="submit" tone="primary">查找</Button>
      </Form>
      {(q || category) && (
        <Card pad={false} title={q ? `“${q}” 的结果` : `「${CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS]}」分类内容`} right={<span>{rows.length === 50 ? "仅显示最近 50 条" : `${rows.length} 条`}</span>}>
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            onRowClick={(r) => navigate(`/admin/content/${r.id}`)}
            empty="没有找到。URL 会先规范化再比对；标题支持中英文片段。"
            columns={[
              {
                key: "t",
                label: "标题",
                render: (r) => (
                  <div className="min-w-[320px]">
                    <Link to={`/admin/content/${r.id}`} className="font-medium text-ink hover:text-accent" onClick={(e) => e.stopPropagation()}>{r.title}</Link>
                    <div className="font-mono text-[11.5px] text-ink-4">{r.id}</div>
                  </div>
                ),
              },
              { key: "src", label: "信源", render: (r) => <span className="whitespace-nowrap">{r.source}</span> },
              {
                key: "st",
                label: "状态",
                render: (r) => (
                  <span className="flex flex-wrap gap-1">
                    {r.selected && <Badge tone="accent">精选</Badge>}
                    {r.visibility && <Badge tone={r.visibility === "public" ? "muted" : "warn"}>{VISIBILITY_LABEL[r.visibility] ?? r.visibility}</Badge>}
                    {!r.visibility && <Badge>{r.processing_state}</Badge>}
                  </span>
                ),
              },
              { key: "sc", label: "分数", align: "right", render: (r) => r.score ?? "—" },
              { key: "d", label: "发现", render: (r) => <Time at={r.discovered_at} /> },
            ]}
          />
        </Card>
      )}
      {!q && !category && <Empty>输入关键词或选择类别以开始查找内容。</Empty>}
    </AdminPage>
  );
}
