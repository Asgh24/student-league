/** Student evaluations: own marks per subject, with class averages and rank. */

import { api } from '../../api.js';
import { el } from '../../dom.js';
import { errorMessage } from '../../format.js';
import { bandKind } from '../../evaluationMeta.js';
import { renderView, setTopbarTitle } from '../../shell.js';
import { emptyState } from '../../ui.js';
import { card, chip, fa, faDate, grid, loadingNode, pageHead, statCard } from '../common.js';
import { studentTabs } from './tabs.js';

function markNodes(item) {
  const nodes = [];
  nodes.push(item.band ? chip(`${item.band.icon} ${item.band.label}`, bandKind(item.band.key)) : chip('ثبت نشده', 'muted'));
  if (item.kind !== 'descriptive') {
    nodes.push(el('span.eval-score', { text: item.score === null || item.score === undefined ? '—' : fa(item.score) }));
  }
  return nodes;
}

function evaluationRow(item) {
  return el('div.timeline-item', {}, [
    el('div', { style: { flex: '1' } }, [
      el('div', {}, [
        el('strong', { text: `${item.subject} — ${item.title}` }),
        el('span.small.muted', { text: ` · ${faDate(item.heldOn)}` }),
      ]),
      el('div.row', { style: { gap: '6px', flexWrap: 'wrap', marginTop: '4px' } }, [
        item.level ? chip(`🏫 ${item.level}`, 'muted') : null,
        item.grade ? chip(`🎓 پایه ${item.grade}`, 'muted') : null,
        item.kind === 'descriptive' ? chip('📝 توصیفی', 'muted') : chip(`⚖️ از ${fa(item.scaleMax)}`),
        item.average === null || item.average === undefined ? null : chip(`میانگین کلاس ${fa(item.average)}`, 'muted'),
        item.rank ? chip(`رتبهٔ ${fa(item.rank)} از ${fa(item.gradedCount)}`, 'muted') : null,
        item.note ? chip(`📌 ${item.note}`) : null,
      ]),
    ]),
    el('span.row', { style: { gap: '6px', alignItems: 'center' } }, markNodes(item)),
  ]);
}

export async function renderStudentEvaluations() {
  setTopbarTitle('ارزشیابی من');
  const body = el('div', {}, [loadingNode()]);
  renderView([body]);

  let data;
  try {
    data = await api.get('/student/evaluations');
  } catch (error) {
    body.replaceChildren(emptyState({ icon: '⚠️', title: 'دریافت ارزشیابی‌ها ناموفق بود', hint: errorMessage(error) }));
    return undefined;
  }

  const items = data.items ?? [];
  const stats = data.stats ?? {};
  const list = el('div');
  if (items.length === 0) {
    list.appendChild(emptyState({ icon: '📝', title: 'هنوز ارزشیابی‌ای ثبت نشده است', hint: 'به‌زودی نمره‌های درسی شما اینجا نمایش داده می‌شود.' }));
  }
  for (const item of items) list.appendChild(evaluationRow(item));

  const subjectChips = el('div.row', { style: { gap: '6px', flexWrap: 'wrap' } });
  for (const subject of stats.subjects ?? []) {
    subjectChips.appendChild(chip(`${subject.subject}: ${fa(subject.average)}`, 'muted'));
  }

  body.replaceChildren(
    pageHead({ icon: '📝', title: 'ارزشیابی من', subtitle: 'نمره‌های ثبت‌شدهٔ معلم به تفکیک درس' }),
    studentTabs('student/evaluations'),
    grid('grid--stats', [
      statCard({ label: 'ارزشیابی‌ها', value: fa(stats.count ?? 0), icon: '📝' }),
      statCard({ label: 'میانگین من', value: stats.average === null || stats.average === undefined ? '—' : fa(stats.average), icon: '📊' }),
      statCard({ label: 'بهترین درس', value: stats.bestSubject ?? '—', icon: '🥇' }),
      statCard({ label: 'نمره‌های عددی', value: fa(stats.graded ?? 0), icon: '🔢' }),
    ]),
    (stats.subjects ?? []).length ? card({ title: 'میانگین هر درس', icon: '📚' }, [subjectChips]) : null,
    card({ title: `فهرست ارزشیابی‌ها (${fa(items.length)})`, icon: '📋' }, [list]),
  );
  return undefined;
}
