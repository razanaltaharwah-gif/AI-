// ============================================
// MathMind AI - Supabase Connection
// ============================================

const SUPABASE_URL = "https://gkzoaftudhjhejtnssxs.supabase.co";
const SUPABASE_KEY = "sb_publishable_qMOWYLxw0K5lteDfGSnYFQ_qXjw-6Tj";

const MATHMIND_STORAGE_BUCKET = "mathmind-files";

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
);

// ============================================
// أدوات مساعدة
// ============================================

function mmGetValue(payload, camel, snake, fallback = null) {
    if (payload?.[camel] !== undefined) return payload[camel];
    if (payload?.[snake] !== undefined) return payload[snake];
    return fallback;
}

function mmNormalizeArray(value) {
    return Array.isArray(value) ? value : [];
}

function mmNormalizeObject(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
}

function mmError(message, error = null) {
    console.error(message, error);
    return {
        data: null,
        error: error || new Error(message)
    };
}

// ============================================
// رفع الصور والملفات إلى Supabase Storage
// ============================================

async function uploadMathMindFile(file, folder = "uploads") {
    try {
        if (!file) {
            throw new Error("لم يتم اختيار ملف.");
        }

        const maxSize = 10 * 1024 * 1024;

        if (file.size > maxSize) {
            throw new Error("حجم الملف أكبر من 10 MB.");
        }

        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");

        const filePath =
            `${folder}/${Date.now()}_${Math.random().toString(36).slice(2)}_${safeName}`;

        const { data, error } = await supabaseClient.storage
            .from(MATHMIND_STORAGE_BUCKET)
            .upload(filePath, file, {
                cacheControl: "3600",
                upsert: false
            });

        if (error) throw error;

        const { data: urlData } = supabaseClient.storage
            .from(MATHMIND_STORAGE_BUCKET)
            .getPublicUrl(data.path);

        return {
            data: {
                path: data.path,
                url: urlData.publicUrl,
                fileName: file.name
            },
            error: null
        };

    } catch (error) {
        return mmError("فشل رفع الملف", error);
    }
}

// ============================================
// حفظ محاولة الطالب
// ============================================

async function saveStudentAttemptToSupabase(payload = {}) {
    try {
        const studentId = mmGetValue(
            payload,
            "studentId",
            "student_id"
        );

        if (!studentId) {
            throw new Error("رقم الطالب غير موجود.");
        }

        const rowData = {
            student_id: studentId,

            question_id: mmGetValue(
                payload,
                "questionId",
                "question_id"
            ),

            lesson: mmGetValue(
                payload,
                "lesson",
                "lesson",
                ""
            ),

            lesson_key: mmGetValue(
                payload,
                "lessonKey",
                "lesson_key",
                ""
            ),

            question: mmGetValue(
                payload,
                "question",
                "question",
                ""
            ),

            written_answer: mmGetValue(
                payload,
                "writtenAnswer",
                "written_answer",
                ""
            ),

            solution_photo: mmGetValue(
                payload,
                "solutionPhoto",
                "solution_photo"
            ),

            hint_used: Number(
                mmGetValue(payload, "hintUsed", "hint_used", 0)
            ) || 0,

            hint_sequence: mmNormalizeArray(
                mmGetValue(payload, "hintSequence", "hint_sequence", [])
            ),

            ai_chat: mmNormalizeArray(
                mmGetValue(payload, "aiChat", "ai_chat", [])
            ),

            ai_evaluation: mmNormalizeObject(
                mmGetValue(payload, "aiEvaluation", "ai_evaluation", {})
            ),

            is_solved: Boolean(
                mmGetValue(payload, "isSolved", "is_solved", false)
            ),

            score: mmGetValue(
                payload,
                "score",
                "score"
            ),

            problem_description: mmGetValue(
                payload,
                "problemDescription",
                "problem_description",
                ""
            ),

            submitted_at: new Date().toISOString()
        };

        const attemptId = mmGetValue(
            payload,
            "attemptId",
            "attempt_id"
        );

        let result;

        if (attemptId !== null && attemptId !== undefined) {
            result = await supabaseClient
                .from("attempts")
                .update(rowData)
                .eq("id", attemptId)
                .select()
                .single();
        } else {
            result = await supabaseClient
                .from("attempts")
                .insert([rowData])
                .select()
                .single();
        }

        if (result.error) throw result.error;

        return {
            data: result.data,
            error: null
        };

    } catch (error) {
        return mmError("تعذر حفظ محاولة الطالب", error);
    }
}

// ============================================
// قراءة محاولات طالب محدد
// ============================================

async function getStudentAttempts(studentId) {
    try {
        const { data, error } = await supabaseClient
            .from("attempts")
            .select("*")
            .eq("student_id", studentId)
            .order("submitted_at", { ascending: true });

        if (error) throw error;

        return {
            data: data || [],
            error: null
        };

    } catch (error) {
        return mmError("تعذر تحميل محاولات الطالب", error);
    }
}

// ============================================
// استدعاء الذكاء الاصطناعي
// ============================================

async function callMathMindAI({
    roleLabel = "MathMind AI",
    systemPrompt = "",
    userPrompt = "",
    contextData = null
} = {}) {
    try {
        const { data, error } = await supabaseClient.functions.invoke(
            "teacher-ai",
            {
                body: {
                    roleLabel,
                    systemPrompt,
                    userPrompt,
                    contextData
                }
            }
        );

        if (error) throw error;

        if (!data?.response) {
            throw new Error("لم يصل رد من خدمة الذكاء الاصطناعي.");
        }

        return data.response;

    } catch (error) {
        console.error("MathMind AI error:", error);

        throw new Error(
            "تعذر الاتصال بمساعد الذكاء الاصطناعي. يرجى المحاولة لاحقًا."
        );
    }
}

// ============================================
// إرسال الواجبات والامتحانات
// ============================================

async function sendAssignmentToStudentPortal(assignmentPayload = {}) {
    try {
        const file = assignmentPayload.file || null;
        let uploadedFile = null;

        if (file) {
            const uploadResult = await uploadMathMindFile(
                file,
                "assignments"
            );

            if (uploadResult.error) {
                throw uploadResult.error;
            }

            uploadedFile = uploadResult.data;
        }

        const record = {
            title: assignmentPayload.title || "واجب جديد",

            section: assignmentPayload.section || "الكل",

            assignment_type:
                assignmentPayload.type || "واجب",

            instructions:
                assignmentPayload.instructions || "",

            file_name:
                uploadedFile?.fileName ||
                assignmentPayload.fileName ||
                null,

            file_data_url: null,

            created_at: new Date().toISOString()
        };

        const { data, error } = await supabaseClient
            .from("assignments")
            .insert([record])
            .select()
            .single();

        if (error) throw error;

        return {
            data,
            error: null
        };

    } catch (error) {
        return mmError("تعذر إرسال الواجب", error);
    }
}

// ============================================
// تحميل واجبات الطلاب
// ============================================

async function loadAssignmentsFromSupabase(section = null) {
    try {
        let query = supabaseClient
            .from("assignments")
            .select("*")
            .order("created_at", { ascending: false });

        if (section && section !== "الكل") {
            query = query.or(
                `section.eq.${section},section.eq.الكل`
            );
        }

        const { data, error } = await query;

        if (error) throw error;

        return {
            data: data || [],
            error: null
        };

    } catch (error) {
        return mmError("تعذر تحميل الواجبات", error);
    }
}

// ============================================
// معلومات الاتصال
// ============================================

async function checkMathMindConnection() {
    try {
        const { error } = await supabaseClient
            .from("schools")
            .select("id")
            .limit(1);

        if (error) throw error;

        return {
            connected: true,
            message: "الاتصال بقاعدة البيانات ناجح."
        };

    } catch (error) {
        console.error(error);

        return {
            connected: false,
            message: "تعذر الاتصال بقاعدة البيانات."
        };
    }
}