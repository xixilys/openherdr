import { useI18n, type Locale } from '@/lib/i18n';

const messages = {
  en: {
    rootUnavailable: 'This workspace has no verified project root.',
    changed: 'Project notes, todos or plans changed. Reload the saved version before saving. Your edits are kept.',
    ownerChanged: 'The selected project changed. Your edits are kept.',
    failed: 'Project context could not be loaded or saved. Your edits are kept.',
  },
  'zh-CN': {
    rootUnavailable: '此工作区没有已确认的项目根目录。',
    changed: '项目笔记、待办或计划已更改。保存前请重新加载已保存的版本。你的编辑已保留。',
    ownerChanged: '选中的项目已更改。你的编辑已保留。',
    failed: '无法加载或保存项目内容。你的编辑已保留。',
  },
  'zh-TW': {
    rootUnavailable: '此工作區沒有已確認的專案根目錄。',
    changed: '專案筆記、待辦或計畫已變更。儲存前請重新載入已儲存的版本。你的編輯已保留。',
    ownerChanged: '選取的專案已變更。你的編輯已保留。',
    failed: '無法載入或儲存專案內容。你的編輯已保留。',
  },
  de: {
    rootUnavailable: 'Für diesen Arbeitsbereich ist kein Projektstamm bestätigt.',
    changed: 'Projektnotizen, Aufgaben oder Pläne wurden geändert. Lade vor dem Speichern die gespeicherte Version neu. Deine Änderungen bleiben erhalten.',
    ownerChanged: 'Das ausgewählte Projekt wurde geändert. Deine Änderungen bleiben erhalten.',
    failed: 'Der Projektkontext konnte nicht geladen oder gespeichert werden. Deine Änderungen bleiben erhalten.',
  },
  fr: {
    rootUnavailable: 'La racine du projet de cet espace de travail n’est pas vérifiée.',
    changed: 'Les notes, tâches ou plans du projet ont changé. Rechargez la version enregistrée avant de sauvegarder. Vos modifications sont conservées.',
    ownerChanged: 'Le projet sélectionné a changé. Vos modifications sont conservées.',
    failed: 'Impossible de charger ou d’enregistrer le contexte du projet. Vos modifications sont conservées.',
  },
  nl: {
    rootUnavailable: 'Deze werkruimte heeft geen geverifieerde projectmap.',
    changed: 'Projectnotities, taken of plannen zijn gewijzigd. Laad de opgeslagen versie opnieuw voordat je opslaat. Je wijzigingen blijven behouden.',
    ownerChanged: 'Het geselecteerde project is gewijzigd. Je wijzigingen blijven behouden.',
    failed: 'De projectcontext kon niet worden geladen of opgeslagen. Je wijzigingen blijven behouden.',
  },
  uk: {
    rootUnavailable: 'Ця робоча область не має підтвердженого кореневого каталогу проєкту.',
    changed: 'Нотатки, завдання або плани проєкту змінилися. Перед збереженням завантажте збережену версію знову. Ваші зміни збережено.',
    ownerChanged: 'Вибраний проєкт змінився. Ваші зміни збережено.',
    failed: 'Не вдалося завантажити або зберегти контекст проєкту. Ваші зміни збережено.',
  },
  es: {
    rootUnavailable: 'Este espacio de trabajo no tiene una raíz de proyecto verificada.',
    changed: 'Las notas, tareas o planes del proyecto han cambiado. Recarga la versión guardada antes de guardar. Tus cambios se conservan.',
    ownerChanged: 'El proyecto seleccionado ha cambiado. Tus cambios se conservan.',
    failed: 'No se pudo cargar o guardar el contexto del proyecto. Tus cambios se conservan.',
  },
  'pt-BR': {
    rootUnavailable: 'Este espaço de trabalho não tem uma raiz de projeto verificada.',
    changed: 'As notas, tarefas ou planos do projeto mudaram. Recarregue a versão salva antes de salvar. Suas alterações foram mantidas.',
    ownerChanged: 'O projeto selecionado mudou. Suas alterações foram mantidas.',
    failed: 'Não foi possível carregar ou salvar o contexto do projeto. Suas alterações foram mantidas.',
  },
  ko: {
    rootUnavailable: '이 작업 공간에는 확인된 프로젝트 루트가 없습니다.',
    changed: '프로젝트 노트, 할 일 또는 계획이 변경되었습니다. 저장하기 전에 저장된 버전을 다시 불러오세요. 편집 내용은 유지됩니다.',
    ownerChanged: '선택한 프로젝트가 변경되었습니다. 편집 내용은 유지됩니다.',
    failed: '프로젝트 내용을 불러오거나 저장할 수 없습니다. 편집 내용은 유지됩니다.',
  },
  pl: {
    rootUnavailable: 'Ten obszar roboczy nie ma zweryfikowanego katalogu głównego projektu.',
    changed: 'Notatki, zadania lub plany projektu uległy zmianie. Przed zapisem wczytaj zapisaną wersję ponownie. Twoje zmiany zostały zachowane.',
    ownerChanged: 'Wybrany projekt uległ zmianie. Twoje zmiany zostały zachowane.',
    failed: 'Nie udało się wczytać lub zapisać kontekstu projektu. Twoje zmiany zostały zachowane.',
  },
  ja: {
    rootUnavailable: 'このワークスペースには確認済みのプロジェクトルートがありません。',
    changed: 'プロジェクトのノート、タスク、または計画が変更されました。保存前に保存済みの版を再読み込みしてください。編集中の内容は保持されています。',
    ownerChanged: '選択中のプロジェクトが変更されました。編集中の内容は保持されています。',
    failed: 'プロジェクトの内容を読み込みまたは保存できませんでした。編集中の内容は保持されています。',
  },
  tr: {
    rootUnavailable: 'Bu çalışma alanının doğrulanmış bir proje kök dizini yok.',
    changed: 'Proje notları, görevleri veya planları değişti. Kaydetmeden önce kayıtlı sürümü yeniden yükleyin. Düzenlemeleriniz korundu.',
    ownerChanged: 'Seçili proje değişti. Düzenlemeleriniz korundu.',
    failed: 'Proje bağlamı yüklenemedi veya kaydedilemedi. Düzenlemeleriniz korundu.',
  },
  ar: {
    rootUnavailable: 'لا يحتوي نطاق العمل هذا على مجلد جذر مشروع تم التحقق منه.',
    changed: 'تغيرت ملاحظات المشروع أو مهامه أو خططه. أعد تحميل النسخة المحفوظة قبل الحفظ. تم الاحتفاظ بتعديلاتك.',
    ownerChanged: 'تغير المشروع المحدد. تم الاحتفاظ بتعديلاتك.',
    failed: 'تعذر تحميل سياق المشروع أو حفظه. تم الاحتفاظ بتعديلاتك.',
  },
  he: {
    rootUnavailable: 'למרחב העבודה הזה אין תיקיית בסיס מאומתת לפרויקט.',
    changed: 'הערות, משימות או תוכניות הפרויקט השתנו. יש לטעון מחדש את הגרסה השמורה לפני השמירה. העריכות שלך נשמרו.',
    ownerChanged: 'הפרויקט שנבחר השתנה. העריכות שלך נשמרו.',
    failed: 'לא ניתן לטעון או לשמור את הקשר הפרויקט. העריכות שלך נשמרו.',
  },
} satisfies Record<Locale, Record<'rootUnavailable' | 'changed' | 'ownerChanged' | 'failed', string>>;

export function useProjectContextText() {
  const { locale } = useI18n();
  return (key: keyof typeof messages.en) => messages[locale][key];
}
