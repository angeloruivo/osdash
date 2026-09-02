import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const SUPABASE_URL = 'https://thyuwjltmpxyuwgefshj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_QPlzmErrbiZkjLoMNty83w_dS4q2nz2';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, detectSessionInUrl: true, flowType: 'pkce' },
});

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const STATUS_COLORS = ['#2f9e63', '#e6a23c', '#d95b67', '#7b8798', '#6c63c7'];
const MODEL_COLORS = {
  ok: '#2f9e63',
  ng_with_warranty: '#e6a23c',
  ng_without_warranty: '#d95b67',
  unserviceable: '#7b8798',
  reuse: '#6c63c7',
};

function rangeFor(year, month) {
  if (year === 0) return { p_start: null, p_end: null };
  if (month === -1) return { p_start: `${year}-01-01`, p_end: `${year}-12-31` };
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return {
    p_start: `${year}-${String(month + 1).padStart(2, '0')}-01`,
    p_end: `${year}-${String(month + 1).padStart(2, '0')}-${last}`,
  };
}

function fillDays(rows, year, month) {
  if (!year || month < 0) return rows;
  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const indexed = new Map(rows.map((row) => [row.day, row]));
  return Array.from({ length: count }, (_, i) => indexed.get(i + 1) || { day: i + 1, visits: 0, equipment: 0 });
}

function short(value, max = 23) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function insightsFor(data) {
  if (!data?.totals.visits) return ['Nenhuma visita encerrada no período selecionado.'];
  const output = [];
  if (data.schools[0]) output.push(`${data.schools[0].name} lidera com ${data.schools[0].visits} visita(s) e ${data.schools[0].equipment} equipamento(s).`);
  if (data.analysts[0]) output.push(`${data.analysts[0].name} concentra o maior volume: ${data.analysts[0].visits} visita(s).`);
  if (data.models[0]) output.push(`${data.models[0].model} é o modelo mais atendido, com ${data.models[0].total} equipamento(s).`);
  const peak = [...data.daily].sort((a, b) => b.visits - a.visits || b.equipment - a.equipment)[0];
  if (peak) output.push(`O pico ocorreu em ${new Date(`${peak.date}T12:00:00`).toLocaleDateString('pt-BR')}, com ${peak.visits} visita(s).`);
  const critical = data.statuses.filter((item) => item.key.startsWith('NG_') || item.key === 'UNSERVICEABLE').reduce((sum, item) => sum + item.value, 0);
  if (data.totals.equipment) output.push(`${Math.round((critical / data.totals.equipment) * 100)}% dos equipamentos atendidos ficaram em NG ou inservíveis.`);
  return output;
}

function Empty() {
  return <div className="empty">▥<span>Sem dados no período selecionado.</span></div>;
}

function visibleValue(value) {
  return Number(value) > 0 ? value : '';
}

function PieValueLabel({ cx, cy, midAngle, innerRadius, outerRadius, value }) {
  if (!value) return null;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.55;
  const angle = (-midAngle * Math.PI) / 180;
  return <text x={cx + radius * Math.cos(angle)} y={cy + radius * Math.sin(angle)} fill="white" textAnchor="middle" dominantBaseline="central" fontSize="11" fontWeight="800">{value}</text>;
}

function Card({ title, subtitle, className = '', children }) {
  return <section className={`card ${className}`}><header><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</header><div className="card-body">{children}</div></section>;
}

function RankChart({ rows, dataKey, color, name }) {
  const data = [...rows].sort((a, b) => b[dataKey] - a[dataKey]).slice(0, 10).map((row) => ({ ...row, label: short(row.name) }));
  if (!data.length) return <Empty />;
  return <div className="chart rank-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={data} layout="vertical" margin={{ left: 12, right: 24 }}><CartesianGrid horizontal={false} strokeDasharray="4 4" /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="label" width={140} tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey={dataKey} name={name} fill={color} radius={[0, 5, 5, 0]}><LabelList dataKey={dataKey} position="insideRight" fill="#fff" fontSize={11} fontWeight={800} formatter={visibleValue} /></Bar></BarChart></ResponsiveContainer></div>;
}

export default function Dashboard() {
  const now = new Date();
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [metrics, setMetrics] = useState(null);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [school, setSchool] = useState('');
  const [analyst, setAnalyst] = useState('');

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      if (sessionError) setError(sessionError.message);
      setUser(data.session?.user || null);
      setReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) {
        setUser(session?.user || null);
        setReady(true);
      }
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    const { data, error: requestError } = await supabase.rpc('sti_dashboard_metrics_filtered', {
      ...rangeFor(year, month),
      p_school: school || null,
      p_analyst: analyst || null,
    });
    if (requestError) {
      setMetrics(null);
      setError(
        requestError.message.includes('STI_DASHBOARD_FORBIDDEN')
          ? 'Esta conta Google não possui acesso de gestor à Central Analítica.'
          : requestError.message.includes('sti_dashboard_metrics_filtered')
            ? 'Execute o arquivo SQL 004_dashboard_filters.sql no Supabase para ativar os novos filtros.'
            : requestError.message,
      );
    } else setMetrics(data);
    setLoading(false);
  }, [user, year, month, school, analyst]);

  useEffect(() => { void load(); }, [load]);

  const years = useMemo(() => Array.from({ length: 7 }, (_, i) => now.getFullYear() - i), [now]);
  const daily = metrics ? fillDays(metrics.daily, year, month) : [];
  const modelData = (metrics?.models || []).slice(0, 12).map((row) => ({ ...row, label: short(row.model, 21) }));
  const schoolOptions = metrics?.filterOptions?.schools || [];
  const analystOptions = metrics?.filterOptions?.analysts || [];

  async function login() {
    setError('');
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const { error: authError } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, queryParams: { prompt: 'select_account' } } });
    if (authError) setError(authError.message);
  }

  async function logout() {
    await supabase.auth.signOut({ scope: 'local' });
    setMetrics(null);
    setUser(null);
  }

  if (!ready) return <main className="center"><div className="spinner" /> Preparando a Central Analítica…</main>;

  if (!user) return <main className="login"><section><div className="login-mark">▥</div><small>GESTÃO · INTELIGÊNCIA OPERACIONAL</small><h1>Central Analítica</h1><p>Indicadores consolidados para acompanhamento da gestão.</p><button onClick={login}>Entrar com Google</button>{error && <div className="error">{error}</div>}</section></main>;

  const kpis = [
    ['Ordens de serviço', metrics?.totals.calls ?? 0, 'OS'],
    ['Visitas encerradas', metrics?.totals.visits ?? 0, 'VI'],
    ['Equipamentos', metrics?.totals.equipment ?? 0, 'EQ'],
    ['Escolas atendidas', metrics?.totals.schools ?? 0, 'ES'],
    ['Analistas ativos', metrics?.totals.analysts ?? 0, 'AN'],
  ];

  return <div className="shell">
    <header className="topbar"><div className="topbar-inner"><div className="brand"><span>▥</span><div><strong>CENTRAL ANALÍTICA</strong><small>Indicadores de gestão</small></div></div><div className="account"><span>{user.user_metadata?.full_name || user.email}</span><button onClick={logout}>Sair</button></div></div></header>
    <main className="main">
      <section className="intro"><div><small>VISÃO CONSOLIDADA</small><h1>Desempenho dos atendimentos</h1><p>Visitas encerradas e equipamentos atendidos no período.</p></div><div className="filters"><select aria-label="Ano" value={year} onChange={(e) => setYear(Number(e.target.value))}><option value="0">Todos os anos</option>{years.map((item) => <option key={item} value={item}>{item}</option>)}</select><select aria-label="Mês" value={month} disabled={!year} onChange={(e) => setMonth(Number(e.target.value))}><option value="-1">Todos os meses</option>{MONTHS.map((item, i) => <option key={item} value={i}>{item}</option>)}</select><select aria-label="Escola" value={school} onChange={(e) => setSchool(e.target.value)}><option value="">Todas as escolas</option>{schoolOptions.map((item) => <option key={item.value} value={item.value}>{item.name}{item.cie ? ` · ${item.cie}` : ''}</option>)}</select><select aria-label="Analista" value={analyst} onChange={(e) => setAnalyst(e.target.value)}><option value="">Todos os analistas</option>{analystOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select><button onClick={load} disabled={loading}>{loading ? 'Atualizando…' : 'Atualizar'}</button></div></section>
      {error && <div className="error panel"><strong>Não foi possível carregar o painel.</strong><span>{error}</span></div>}
      <section className="kpis">{kpis.map(([label, value, icon]) => <article className="kpi" key={label}><span>{icon}</span><div><small>{label}</small><strong>{loading ? '—' : Number(value).toLocaleString('pt-BR')}</strong></div></article>)}</section>
      <section className="grid">
        <Card title="Situação dos equipamentos" subtitle="Resultado mais recente no período.">{!metrics?.totals.equipment ? <Empty /> : <div className="status-layout"><div className="chart pie-chart"><ResponsiveContainer><PieChart><Pie data={metrics.statuses} dataKey="value" nameKey="label" innerRadius={54} outerRadius={82} paddingAngle={3} label={<PieValueLabel />} labelLine={false}>{metrics.statuses.map((item, i) => <Cell key={item.key} fill={STATUS_COLORS[i]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer></div><div className="status-list">{metrics.statuses.map((item, i) => <div key={item.key}><i style={{ background: STATUS_COLORS[i] }} /><span>{item.label}</span><strong>{item.value}</strong></div>)}</div></div>}</Card>
        <Card title="Apontamentos do período" subtitle="Destaques gerados automaticamente."><ol className="insights">{insightsFor(metrics).map((text, i) => <li key={text}><span>{i + 1}</span><p>{text}</p></li>)}</ol></Card>
        <Card className="wide" title="Frequência de visitas por dia" subtitle="Dias com maior movimento e volume de equipamentos.">{!daily.length ? <Empty /> : <div className="chart daily-chart"><ResponsiveContainer><AreaChart data={daily} margin={{ left: 0, right: 12, top: 24, bottom: 12 }}><defs><linearGradient id="fillVisits" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#0756b5" stopOpacity=".35" /><stop offset="95%" stopColor="#0756b5" stopOpacity=".02" /></linearGradient></defs><CartesianGrid vertical={false} strokeDasharray="4 4" /><XAxis dataKey="day" /><YAxis allowDecimals={false} width={28} /><Tooltip /><Legend /><Area type="monotone" dataKey="equipment" name="Equipamentos" stroke="#24a36a" fill="transparent" strokeWidth={3}><LabelList dataKey="equipment" position="bottom" fill="#187448" fontSize={10} formatter={visibleValue} /></Area><Area type="monotone" dataKey="visits" name="Visitas" stroke="#0756b5" fill="url(#fillVisits)" strokeWidth={3}><LabelList dataKey="visits" position="top" fill="#0756b5" fontSize={10} fontWeight={700} formatter={visibleValue} /></Area></AreaChart></ResponsiveContainer></div>}</Card>
        <Card title="Ranking de escolas por visitas" subtitle="Unidades com maior número de visitas."><RankChart rows={metrics?.schools || []} dataKey="visits" name="Visitas" color="#246dcc" /></Card>
        <Card title="Ranking de escolas por equipamentos" subtitle="Unidades com maior volume de equipamentos."><RankChart rows={metrics?.schools || []} dataKey="equipment" name="Equipamentos" color="#24a36a" /></Card>
        <Card title="Ranking de analistas por visitas" subtitle="Responsáveis com maior número de visitas."><RankChart rows={metrics?.analysts || []} dataKey="visits" name="Visitas" color="#246dcc" /></Card>
        <Card title="Ranking de analistas por equipamentos" subtitle="Responsáveis com maior volume de equipamentos."><RankChart rows={metrics?.analysts || []} dataKey="equipment" name="Equipamentos" color="#24a36a" /></Card>
        <Card className="wide" title="Modelos mais atendidos" subtitle="Distribuição por resultado em cada modelo.">{!modelData.length ? <Empty /> : <div className="chart model-chart"><ResponsiveContainer><BarChart data={modelData} layout="vertical" margin={{ left: 10, right: 18 }}><CartesianGrid horizontal={false} strokeDasharray="4 4" /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="label" width={145} tick={{ fontSize: 11 }} /><Tooltip /><Legend /><Bar dataKey="ok" name="OK" stackId="s" fill={MODEL_COLORS.ok}><LabelList dataKey="ok" position="center" fill="#fff" fontSize={10} fontWeight={800} formatter={visibleValue} /></Bar><Bar dataKey="ng_with_warranty" name="NG com garantia" stackId="s" fill={MODEL_COLORS.ng_with_warranty}><LabelList dataKey="ng_with_warranty" position="center" fill="#fff" fontSize={10} fontWeight={800} formatter={visibleValue} /></Bar><Bar dataKey="ng_without_warranty" name="NG sem garantia" stackId="s" fill={MODEL_COLORS.ng_without_warranty}><LabelList dataKey="ng_without_warranty" position="center" fill="#fff" fontSize={10} fontWeight={800} formatter={visibleValue} /></Bar><Bar dataKey="unserviceable" name="Inservível" stackId="s" fill={MODEL_COLORS.unserviceable}><LabelList dataKey="unserviceable" position="center" fill="#fff" fontSize={10} fontWeight={800} formatter={visibleValue} /></Bar><Bar dataKey="reuse" name="Reaproveitamento" stackId="s" fill={MODEL_COLORS.reuse}><LabelList dataKey="reuse" position="center" fill="#fff" fontSize={10} fontWeight={800} formatter={visibleValue} /></Bar></BarChart></ResponsiveContainer></div>}</Card>
      </section>
      <footer>Dados consolidados do Supabase · Atualizado {metrics ? new Date(metrics.generatedAt).toLocaleString('pt-BR') : '—'}</footer>
    </main>
  </div>;
}
