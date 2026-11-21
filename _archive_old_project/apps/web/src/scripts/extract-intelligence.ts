import { store } from '../lib/store';

function runExtraction() {
  const stats = store.getDashboardStats();
  console.log('========================================================================================');
  console.log('🔍 منصة SCOUTZERO: مستخرج بيانات المواهب والماني بول للدوري المصري (Intelligence Report)');
  console.log('========================================================================================\n');

  console.log('📌 أبرز المواهب المغمورة المكتشفة في الدرجة الثانية والأقاليم (Top Undervalued Gems):\n');

  stats.topUndervalued.forEach((p, idx) => {
    console.log(`[#${idx + 1}] ${p.nameAr} (${p.nameEn}) - مركز: ${p.positionPrimary}`);
    console.log(`     النادي الحالي: ${p.teamNameAr} (دوري الدرجة ${p.leagueTier}) | المحافظة: ${p.governorate}`);
    console.log(`     السن: ${p.age} سنة | تاريخ الميلاد: ${p.dateOfBirth} | القدم المفضلة: ${p.preferredFoot === 'left' ? 'اليسرى' : 'اليمنى'}`);
    console.log(`     الراتب الشهري الفعلي: ${p.monthlySalaryEgp.toLocaleString('ar-EG')} ج.م/شهر | الشرط الجزائي: ${(p.contractClauseEgp / 1000).toLocaleString('ar-EG')} ألف ج.م (شريحة التكلفة: ${p.mui.components.costBand})`);
    console.log(`     مؤشر ماني بول (MUI): ${p.mui.score}/100 (${p.mui.confidence}) | الدقائق المعتمدة: ${p.minutesPlayed} دقيقة`);
    console.log(`     مكونات الحساب: أداء فني=${p.mui.components.performanceScore} | معامل صغر السن=x${p.mui.components.ageFactor} | معامل الضغط=x${p.mui.components.pressureFactor} | مقسم التكلفة=${p.mui.components.costDivider}`);
    console.log(`     مطابقة الجينات التكتيكية (DNA - كمرجع تشبيهي): ${p.topArchetype.similarityPercentage}% تطابق مع النمط المعياري: ${p.topArchetype.archetypeNameAr} (${p.topArchetype.benchmarkPlayer})`);
    console.log(`     أبرز نقاط القوة: ${p.topArchetype.strengths.slice(0, 2).map(s => s.labelAr).join('، ')}`);
    console.log('----------------------------------------------------------------------------------------');
  });

  console.log('\n📌 لوحة التعاقدات وتوزيع المرشحين حسب احتياجات الفريق (Recruitment Board Needs):\n');
  const needs = store.getRecruitmentNeeds();
  needs.forEach(n => {
    console.log(`🎯 الاحتياج الفني: ${n.titleAr}`);
    console.log(`   المركز: ${n.positionGroup} | القدم المطلوبة: ${n.targetFoot} | الحد الأقصى للسن: ${n.maxAge} سنة | سقف الراتب الشهري: ${n.maxMonthlySalaryEgp.toLocaleString('ar-EG')} ج.م/ش`);
    n.candidates.forEach(c => {
      const player = store.getPlayerById(c.playerId);
      console.log(`   ← المرشح: ${player?.nameAr} (${player?.teamNameAr}) | نسبة الملاءمة: ${c.fitScore}% | المرحلة: [${c.stage}]`);
      console.log(`     سبب الترشيح: ${c.fitReason}`);
    });
    console.log('');
  });

  console.log('📌 توزيع تغطية الكشافين في محافظات مصر (Geographical Coverage):\n');
  Object.entries(stats.govCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .forEach(([gov, count]) => {
      console.log(`   • محافظة ${gov}: ${count} لاعباً مرصوداً ومقيماً`);
    });
  console.log('\n========================================================================================');
}

runExtraction();
