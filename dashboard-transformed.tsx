import { createHotContext as __vite__createHotContext } from "/@vite/client";import.meta.hot = __vite__createHotContext("/src/components/DashboardView.tsx");import __vite__cjsImport0_react_jsxDevRuntime from "/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=6a93e62d"; const jsxDEV = __vite__cjsImport0_react_jsxDevRuntime["jsxDEV"];
import { Users, AlertTriangle, Percent, GraduationCap, Clock, CheckCircle, XCircle, Award } from "/node_modules/.vite/deps/lucide-react.js?v=6a93e62d";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, PieChart, Pie, Cell } from "/node_modules/.vite/deps/recharts.js?v=6a93e62d";
import { getGradeBadgeClass, getGradeBand } from "/src/lib/gradeColor.ts";
export function normalizeDashboardChartData(rawData) {
  if (!Array.isArray(rawData)) return [];
  return rawData.reduce((acc, item) => {
    if (!item || typeof item !== "object") return acc;
    const record = item;
    const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : typeof record.label === "string" && record.label.trim() ? record.label.trim() : typeof record.className === "string" && record.className.trim() ? record.className.trim() : null;
    const rawValue = typeof record.taux === "number" ? record.taux : typeof record.value === "number" ? record.value : typeof record.attendanceRate === "number" ? record.attendanceRate : typeof record.percent === "number" ? record.percent : null;
    if (!name || rawValue == null) return acc;
    const clampedValue = Math.max(0, Math.min(100, Number(rawValue)));
    acc.push({ name, taux: Number.isFinite(clampedValue) ? clampedValue : 0 });
    return acc;
  }, []);
}
export default function DashboardView({
  stats,
  recentAbsences,
  recentGrades,
  userRole,
  chartData = []
}) {
  console.log("Statistiques reçues par DashboardView :", stats);
  console.log("Graphique reçu :", chartData);
  console.log("TYPE chartData:", typeof chartData);
  console.log("IS ARRAY:", Array.isArray(chartData));
  console.log("CONTENT SAMPLE:", chartData?.slice?.(0, 5));
  const attendanceData = normalizeDashboardChartData(chartData);
  const justifiedCount = recentAbsences.filter((a) => a.isJustified).length;
  const unjustifiedCount = recentAbsences.filter((a) => !a.isJustified).length;
  const totalAbsenceCount = justifiedCount + unjustifiedCount;
  const pieData = [
    { name: "Justifiées", value: justifiedCount, color: "#10b981" },
    { name: "Non Justifiées", value: unjustifiedCount, color: "#ef4444" }
  ];
  return /* @__PURE__ */ jsxDEV("div", { className: "space-y-6", id: "dashboard-view", children: [
    /* @__PURE__ */ jsxDEV("div", { className: "flex justify-between items-center", children: /* @__PURE__ */ jsxDEV("div", { children: [
      /* @__PURE__ */ jsxDEV("h2", { className: "text-2xl font-bold text-slate-800", children: "Tableau de Bord Général" }, void 0, false, {
        fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
        lineNumber: 84,
        columnNumber: 11
      }, this),
      /* @__PURE__ */ jsxDEV("p", { className: "text-sm text-slate-500", children: "Statistiques de fréquentation globale et vue d’ensemble en temps réel" }, void 0, false, {
        fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
        lineNumber: 85,
        columnNumber: 11
      }, this)
    ] }, void 0, true, {
      fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
      lineNumber: 83,
      columnNumber: 9
    }, this) }, void 0, false, {
      fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
      lineNumber: 82,
      columnNumber: 7
    }, this),
    /* @__PURE__ */ jsxDEV("div", { className: "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5", children: [
      /* @__PURE__ */ jsxDEV("div", { className: "bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between", id: "card-stats-students", children: [
        /* @__PURE__ */ jsxDEV("div", { className: "space-y-1", children: [
          /* @__PURE__ */ jsxDEV("span", { className: "text-xs font-semibold text-slate-400 uppercase tracking-wider", children: "Effectif Total" }, void 0, false, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
            lineNumber: 95,
            columnNumber: 13
          }, this),
          /* @__PURE__ */ jsxDEV("p", { className: "text-3xl font-bold text-slate-800", children: stats.totalStudents }, void 0, false, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
            lineNumber: 96,
            columnNumber: 13
          }, this),
          /* @__PURE__ */ jsxDEV("p", { className: "text-xs text-indigo-500 font-semibold tracking-tight", children: "Élèves inscrits" }, void 0, false, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
            lineNumber: 97,
            columnNumber: 13
          }, this)
        ] }, void 0, true, {
          fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
          lineNumber: 94,
          columnNumber: 11
        }, this),
        /* @__PURE__ */ jsxDEV("div", { className: "p-3 bg-indigo-50 text-indigo-600 rounded-xl", children: /* @__PURE__ */ jsxDEV(Users, { className: "h-6 w-6" }, void 0, false, {
          fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
          lineNumber: 100,
          columnNumber: 13
        }, this) }, void 0, false, {
          fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
          lineNumber: 99,
          columnNumber: 11
        }, this)
      ] }, void 0, true, {
        fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
        lineNumber: 93,
        columnNumber: 9
      }, this),
      userRole !== "parent" && /* @__PURE__ */ jsxDEV("div", { className: "bg-white p-5 rounded-2xl border border-slate-100 shadow-sm", id: "card-stats-gender", children: /* @__PURE__ */ jsxDEV("div", { className: "space-y-4", children: [
        /* @__PURE__ */ jsxDEV("span", { className: "text-xs font-semibold text-slate-400 uppercase tracking-wider", children: "Répartition par genre" }, void 0, false, {
          fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
          lineNumber: 108,
          columnNumber: 15
        }, this),
        /* @__PURE__ */ jsxDEV("div", { className: "grid grid-cols-2 gap-3", children: [
          /* @__PURE__ */ jsxDEV("div", { className: "bg-slate-50 rounded-2xl p-4", children: [
            /* @__PURE__ */ jsxDEV("p", { className: "text-xs text-slate-500 uppercase tracking-wider", children: "Garçons" }, void 0, false, {
              fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
              lineNumber: 111,
              columnNumber: 19
            }, this),
            /* @__PURE__ */ jsxDEV("p", { className: "text-2xl font-bold text-slate-800", children: stats.maleStudents || 0 }, void 0, false, {
              fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
              lineNumber: 112,
              columnNumber: 19
            }, this)
          ] }, void 0, true, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
            lineNumber: 110,
            columnNumber: 17
          }, this),
          /* @__PURE__ */ jsxDEV("div", { className: "bg-slate-50 rounded-2xl p-4", children: [
            /* @__PURE__ */ jsxDEV("p", { className: "text-xs text-slate-500 uppercase tracking-wider", children: "Filles" }, void 0, false, {
              fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
              lineNumber: 115,
              columnNumber: 19
            }, this),
            /* @__PURE__ */ jsxDEV("p", { className: "text-2xl font-bold text-slate-800", children: stats.femaleStudents || 0 }, void 0, false, {
              fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
              lineNumber: 116,
              columnNumber: 19
            }, this)
          ] }, void 0, true, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
            lineNumber: 114,
            columnNumber: 17
          }, this)
        ] }, void 0, true, {
          fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
          lineNumber: 109,
          columnNumber: 15
        }, this),
        stats.unknownGenderStudents && stats.unknownGenderStudents > 0 && /* @__PURE__ */ jsxDEV("p", { className: "text-[11px] text-slate-500", children: [
          stats.unknownGenderStudents,
          " non renseigné",
          stats.unknownGenderStudents > 1 ? "s" : ""
        ] }, void 0, true, {
          fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
          lineNumber: 120,
          columnNumber: 13
        }, this)
      ] }, void 0, true, {
        fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
        lineNumber: 107,
        columnNumber: 13
      }, this) }, void 0, false, {
        fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
        lineNumber: 106,
        columnNumber: 9
      }, this),
      /* @__PURE__ */ jsxDEV("div", { className: "bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between", id: "card-stats-absences", children: [
        /* @__PURE__ */ jsxDEV("div", { className: "space-y-1", children: [
          /* @__PURE__ */ jsxDEV("span", { className: "text-xs font-semibold text-slate-400 uppercase tracking-wider", children: "Absences enregistrées" }, void 0, false, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
            lineNumber: 129,
            columnNumber: 13
          }, this),
          /* @__PURE__ */ jsxDEV("p", { className: "text-3xl font-bold text-slate-800", children: stats.totalAbsences }, void 0, false, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
            lineNumber: 130,
            columnNumber: 13
          }, this),
          /* @__PURE__ */ jsxDEV("p", { className: "text-xs text-rose-500 font-semibold tracking-tight", children: "Depuis l’ouverture de l’année" }, void 0, false, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
            lineNumber: 131,
            columnNumber: 13
          }, this)
        ] }, void 0, true, {
          fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
          lineNumber: 128,
          columnNumber: 11
        }, this),
        /* @__PURE__ */ jsxDEV("div", { className: "p-3 bg-rose-50 text-rose-600 rounded-xl", children: /* @__PURE__ */ jsxDEV(AlertTriangle, { className: "h-6 w-6" }, void 0, false, {
          fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
          lineNumber: 134,
          columnNumber: 13
        }, this) }, void 0, false, {
          fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
          lineNumber: 133,
          columnNumber: 11
        }, this)
      ] }, void 0, true, {
        fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
        lineNumber: 127,
        columnNumber: 9
      }, this),
      /* @__PURE__ */ jsxDEV("div", { className: "bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between", id: "card-stats-rate", children: [
        /* @__PURE__ */ jsxDEV("div", { className: "space-y-1", children: [
          /* @__PURE__ */ jsxDEV("span", { className: "text-xs font-semibold text-slate-400 uppercase tracking-wider", children: "Taux de Fréquentation" }, void 0, false, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
            lineNumber: 141,
            columnNumber: 13
          }, this),
          /* @__PURE__ */ jsxDEV("p", { className: "text-3xl font-bold text-slate-800", children: [
            stats.attendanceRate,
            "%"
          ] }, void 0, true, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
            lineNumber: 142,
            columnNumber: 13
          }, this),
          /* @__PURE__ */ jsxDEV("p", { className: "text-xs text-emerald-500 font-semibold tracking-tight", children: "Taux moyen de présence" }, void 0, false, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
            lineNumber: 143,
            columnNumber: 13
          }, this)
        ] }, void 0, true, {
          fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
          lineNumber: 140,
          columnNumber: 11
        }, this),
        /* @__PURE__ */ jsxDEV("div", { className: "p-3 bg-emerald-50 text-emerald-600 rounded-xl", children: /* @__PURE__ */ jsxDEV(Percent, { className: "h-6 w-6" }, void 0, false, {
          fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
          lineNumber: 146,
          columnNumber: 13
        }, this) }, void 0, false, {
          fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
          lineNumber: 145,
          columnNumber: 11
        }, this)
      ] }, void 0, true, {
        fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
        lineNumber: 139,
        columnNumber: 9
      }, this),
      /* @__PURE__ */ jsxDEV("div", { className: "bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between", id: "card-stats-classes", children: [
        /* @__PURE__ */ jsxDEV("div", { className: "space-y-1", children: [
          /* @__PURE__ */ jsxDEV("span", { className: "text-xs font-semibold text-slate-400 uppercase tracking-wider", children: "Classes & Acteurs" }, void 0, false, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
            lineNumber: 153,
            columnNumber: 13
          }, this),
          /* @__PURE__ */ jsxDEV("p", { className: "text-3xl font-bold text-slate-800", children: stats.totalClasses }, void 0, false, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
            lineNumber: 154,
            columnNumber: 13
          }, this),
          /* @__PURE__ */ jsxDEV("p", { className: "text-xs text-slate-500", children: "Divisions de l’établissement" }, void 0, false, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
            lineNumber: 155,
            columnNumber: 13
          }, this)
        ] }, void 0, true, {
          fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
          lineNumber: 152,
          columnNumber: 11
        }, this),
        /* @__PURE__ */ jsxDEV("div", { className: "p-3 bg-amber-50 text-amber-600 rounded-xl", children: /* @__PURE__ */ jsxDEV(GraduationCap, { className: "h-6 w-6" }, void 0, false, {
          fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
          lineNumber: 158,
          columnNumber: 13
        }, this) }, void 0, false, {
          fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
          lineNumber: 157,
          columnNumber: 11
        }, this)
      ] }, void 0, true, {
        fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
        lineNumber: 151,
        columnNumber: 9
      }, this)
    ] }, void 0, true, {
      fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
      lineNumber: 90,
      columnNumber: 7
    }, this),
    /* @__PURE__ */ jsxDEV("div", { className: "grid grid-cols-1 gap-6", children: [
      userRole !== "parent" && /* @__PURE__ */ jsxDEV("div", { className: "bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4", children: [
        /* @__PURE__ */ jsxDEV("div", { children: [
          /* @__PURE__ */ jsxDEV("h3", { className: "font-bold text-slate-800", children: "Fréquentation par Division (%)" }, void 0, false, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
            lineNumber: 168,
            columnNumber: 15
          }, this),
          /* @__PURE__ */ jsxDEV("p", { className: "text-xs text-slate-400", children: "Taux moyen de présence pour les classes principales" }, void 0, false, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
            lineNumber: 169,
            columnNumber: 15
          }, this)
        ] }, void 0, true, {
          fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
          lineNumber: 167,
          columnNumber: 13
        }, this),
        /* @__PURE__ */ jsxDEV("div", { className: "h-64 wc-chart", style: { minWidth: 0, minHeight: 0 }, children: /* @__PURE__ */ jsxDEV(ResponsiveContainer, { width: "100%", height: "100%", children: /* @__PURE__ */ jsxDEV(BarChart, { data: attendanceData, margin: { top: 20, right: 10, left: -20, bottom: 5 }, children: [
          /* @__PURE__ */ jsxDEV(CartesianGrid, { strokeDasharray: "3 3", vertical: false, stroke: "#f1f5f9" }, void 0, false, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
            lineNumber: 174,
            columnNumber: 19
          }, this),
          /* @__PURE__ */ jsxDEV(XAxis, { dataKey: "name", tick: { fill: "#64748b", fontSize: 11 } }, void 0, false, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
            lineNumber: 175,
            columnNumber: 19
          }, this),
          /* @__PURE__ */ jsxDEV(YAxis, { domain: [0, 100], tick: { fill: "#64748b", fontSize: 11 } }, void 0, false, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
            lineNumber: 176,
            columnNumber: 19
          }, this),
          /* @__PURE__ */ jsxDEV(Tooltip, { cursor: { fill: "#f8fafc" } }, void 0, false, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
            lineNumber: 177,
            columnNumber: 19
          }, this),
          /* @__PURE__ */ jsxDEV(Bar, { dataKey: "taux", fill: "#4f46e5", radius: [6, 6, 0, 0], children: /* @__PURE__ */ jsxDEV(LabelList, { dataKey: "taux", position: "top", style: { fontSize: 11, fill: "#64748b", fontWeight: "bold" } }, void 0, false, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
            lineNumber: 179,
            columnNumber: 21
          }, this) }, void 0, false, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
            lineNumber: 178,
            columnNumber: 19
          }, this)
        ] }, void 0, true, {
          fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
          lineNumber: 173,
          columnNumber: 17
        }, this) }, void 0, false, {
          fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
          lineNumber: 172,
          columnNumber: 15
        }, this) }, void 0, false, {
          fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
          lineNumber: 171,
          columnNumber: 13
        }, this)
      ] }, void 0, true, {
        fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
        lineNumber: 166,
        columnNumber: 9
      }, this),
      /* @__PURE__ */ jsxDEV("div", { className: "bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4", children: [
        /* @__PURE__ */ jsxDEV("div", { children: [
          /* @__PURE__ */ jsxDEV("h3", { className: "font-bold text-slate-800", children: "Statut des Absences" }, void 0, false, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
            lineNumber: 189,
            columnNumber: 13
          }, this),
          /* @__PURE__ */ jsxDEV("p", { className: "text-xs text-slate-400", children: "Répartition entre absences déclarées et justifiées" }, void 0, false, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
            lineNumber: 190,
            columnNumber: 13
          }, this)
        ] }, void 0, true, {
          fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
          lineNumber: 188,
          columnNumber: 11
        }, this),
        /* @__PURE__ */ jsxDEV("div", { className: "h-44 flex items-center justify-center relative", style: { minWidth: 0, minHeight: 0 }, children: [
          /* @__PURE__ */ jsxDEV(ResponsiveContainer, { width: "100%", height: "100%", children: /* @__PURE__ */ jsxDEV(PieChart, { children: [
            /* @__PURE__ */ jsxDEV(
              Pie,
              {
                data: pieData,
                cx: "50%",
                cy: "50%",
                innerRadius: 50,
                outerRadius: 75,
                paddingAngle: 5,
                dataKey: "value",
                children: pieData.map(
                  (entry, index) => /* @__PURE__ */ jsxDEV(Cell, { fill: entry.color }, `cell-${index}`, false, {
                    fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
                    lineNumber: 205,
                    columnNumber: 19
                  }, this)
                )
              },
              void 0,
              false,
              {
                fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
                lineNumber: 195,
                columnNumber: 17
              },
              this
            ),
            /* @__PURE__ */ jsxDEV(Tooltip, {}, void 0, false, {
              fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
              lineNumber: 208,
              columnNumber: 17
            }, this)
          ] }, void 0, true, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
            lineNumber: 194,
            columnNumber: 15
          }, this) }, void 0, false, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
            lineNumber: 193,
            columnNumber: 13
          }, this),
          /* @__PURE__ */ jsxDEV("div", { className: "absolute text-center", children: [
            /* @__PURE__ */ jsxDEV("span", { className: "text-xs text-slate-400 uppercase font-bold tracking-wider", children: "Total" }, void 0, false, {
              fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
              lineNumber: 212,
              columnNumber: 15
            }, this),
            /* @__PURE__ */ jsxDEV("p", { className: "text-xl font-black text-slate-800", children: totalAbsenceCount }, void 0, false, {
              fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
              lineNumber: 213,
              columnNumber: 15
            }, this)
          ] }, void 0, true, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
            lineNumber: 211,
            columnNumber: 13
          }, this)
        ] }, void 0, true, {
          fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
          lineNumber: 192,
          columnNumber: 11
        }, this),
        /* @__PURE__ */ jsxDEV("div", { className: "space-y-2 pt-2 border-t border-slate-100", children: pieData.map(
          (d) => /* @__PURE__ */ jsxDEV("div", { className: "flex justify-between items-center text-xs", children: [
            /* @__PURE__ */ jsxDEV("span", { className: "flex items-center gap-2 text-slate-500 text-xs", children: [
              /* @__PURE__ */ jsxDEV("span", { className: "w-3 h-3 rounded-full inline-block", style: { backgroundColor: d.color } }, void 0, false, {
                fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
                lineNumber: 220,
                columnNumber: 19
              }, this),
              d.name
            ] }, void 0, true, {
              fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
              lineNumber: 219,
              columnNumber: 17
            }, this),
            /* @__PURE__ */ jsxDEV("span", { className: "font-bold text-slate-800", children: d.value }, void 0, false, {
              fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
              lineNumber: 223,
              columnNumber: 17
            }, this)
          ] }, d.name, true, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
            lineNumber: 218,
            columnNumber: 13
          }, this)
        ) }, void 0, false, {
          fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
          lineNumber: 216,
          columnNumber: 11
        }, this)
      ] }, void 0, true, {
        fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
        lineNumber: 187,
        columnNumber: 9
      }, this)
    ] }, void 0, true, {
      fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
      lineNumber: 164,
      columnNumber: 7
    }, this),
    /* @__PURE__ */ jsxDEV("div", { className: "grid grid-cols-1 lg:grid-cols-2 gap-6", children: [
      /* @__PURE__ */ jsxDEV("div", { className: "bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4", children: [
        /* @__PURE__ */ jsxDEV("div", { className: "flex justify-between items-center", children: [
          /* @__PURE__ */ jsxDEV("h3", { className: "font-bold text-slate-800 flex items-center gap-2", children: [
            /* @__PURE__ */ jsxDEV(Clock, { className: "h-5 w-5 text-indigo-500" }, void 0, false, {
              fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
              lineNumber: 237,
              columnNumber: 15
            }, this),
            "Absences Signalées Récemment"
          ] }, void 0, true, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
            lineNumber: 236,
            columnNumber: 13
          }, this),
          /* @__PURE__ */ jsxDEV("span", { className: "text-xs bg-slate-50 text-slate-500 font-semibold px-2 py-1 rounded-lg", children: "Temps Réel" }, void 0, false, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
            lineNumber: 240,
            columnNumber: 13
          }, this)
        ] }, void 0, true, {
          fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
          lineNumber: 235,
          columnNumber: 11
        }, this),
        /* @__PURE__ */ jsxDEV("div", { className: "divide-y divide-slate-50", children: recentAbsences && recentAbsences.length > 0 ? recentAbsences.map(
          (abs, i) => /* @__PURE__ */ jsxDEV("div", { className: "py-3 flex items-center justify-between text-xs sm:text-sm", children: [
            /* @__PURE__ */ jsxDEV("div", { children: [
              /* @__PURE__ */ jsxDEV("p", { className: "font-bold text-slate-800", children: abs.studentName }, void 0, false, {
                fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
                lineNumber: 248,
                columnNumber: 21
              }, this),
              /* @__PURE__ */ jsxDEV("p", { className: "text-xs text-slate-400", children: [
                "Classe : ",
                abs.className,
                " • Date : ",
                abs.date
              ] }, void 0, true, {
                fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
                lineNumber: 249,
                columnNumber: 21
              }, this)
            ] }, void 0, true, {
              fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
              lineNumber: 247,
              columnNumber: 19
            }, this),
            /* @__PURE__ */ jsxDEV("div", { className: "flex items-center gap-2", children: [
              /* @__PURE__ */ jsxDEV("span", { className: "text-xs text-slate-500 capitalize bg-slate-100 px-2.5 py-1 rounded-md", children: abs.period === "morning" ? "Matin" : abs.period === "afternoon" ? "Après-midi" : "Journée" }, void 0, false, {
                fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
                lineNumber: 252,
                columnNumber: 21
              }, this),
              abs.isJustified ? /* @__PURE__ */ jsxDEV("span", { className: "flex items-center gap-1 text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg font-bold text-xs", children: [
                /* @__PURE__ */ jsxDEV(CheckCircle, { className: "h-3 w-3" }, void 0, false, {
                  fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
                  lineNumber: 257,
                  columnNumber: 25
                }, this),
                "Justifiée"
              ] }, void 0, true, {
                fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
                lineNumber: 256,
                columnNumber: 17
              }, this) : /* @__PURE__ */ jsxDEV("span", { className: "flex items-center gap-1 text-rose-600 bg-rose-50 px-2 py-1 rounded-lg font-bold text-xs", children: [
                /* @__PURE__ */ jsxDEV(XCircle, { className: "h-3 w-3" }, void 0, false, {
                  fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
                  lineNumber: 262,
                  columnNumber: 25
                }, this),
                "A Justifier"
              ] }, void 0, true, {
                fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
                lineNumber: 261,
                columnNumber: 17
              }, this)
            ] }, void 0, true, {
              fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
              lineNumber: 251,
              columnNumber: 19
            }, this)
          ] }, abs.id || i, true, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
            lineNumber: 246,
            columnNumber: 13
          }, this)
        ) : /* @__PURE__ */ jsxDEV("p", { className: "text-slate-400 py-4 text-center text-xs", children: "Aucune absence enregistrée ces derniers jours." }, void 0, false, {
          fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
          lineNumber: 270,
          columnNumber: 13
        }, this) }, void 0, false, {
          fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
          lineNumber: 243,
          columnNumber: 11
        }, this)
      ] }, void 0, true, {
        fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
        lineNumber: 234,
        columnNumber: 9
      }, this),
      /* @__PURE__ */ jsxDEV("div", { className: "bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4", children: [
        /* @__PURE__ */ jsxDEV("div", { className: "flex justify-between items-center", children: [
          /* @__PURE__ */ jsxDEV("h3", { className: "font-bold text-slate-800 flex items-center gap-2", children: [
            /* @__PURE__ */ jsxDEV(Award, { className: "h-5 w-5 text-indigo-500" }, void 0, false, {
              fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
              lineNumber: 279,
              columnNumber: 15
            }, this),
            "Dernières Évaluations & Notes"
          ] }, void 0, true, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
            lineNumber: 278,
            columnNumber: 13
          }, this),
          /* @__PURE__ */ jsxDEV("span", { className: "text-xs bg-emerald-50 text-emerald-600 px-2 py-1 rounded-lg font-semibold", children: "Publiées" }, void 0, false, {
            fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
            lineNumber: 282,
            columnNumber: 13
          }, this)
        ] }, void 0, true, {
          fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
          lineNumber: 277,
          columnNumber: 11
        }, this),
        /* @__PURE__ */ jsxDEV("div", { className: "divide-y divide-slate-50", children: recentGrades && recentGrades.length > 0 ? recentGrades.map(
          (grade, i) => (() => {
            const maxScore = grade.maxScore != null ? Number(grade.maxScore) : 20;
            const gradeBand = getGradeBand(grade.score, maxScore);
            const gradeBadgeClass = getGradeBadgeClass(gradeBand);
            return /* @__PURE__ */ jsxDEV("div", { className: "py-3 flex items-center justify-between text-xs sm:text-sm", children: [
              /* @__PURE__ */ jsxDEV("div", { children: [
                /* @__PURE__ */ jsxDEV("p", { className: "font-bold text-slate-800", children: grade.studentName }, void 0, false, {
                  fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
                  lineNumber: 296,
                  columnNumber: 25
                }, this),
                /* @__PURE__ */ jsxDEV("p", { className: "text-xs text-slate-400", children: [
                  grade.subject,
                  " • ",
                  grade.evaluationTitle || "Devoir"
                ] }, void 0, true, {
                  fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
                  lineNumber: 297,
                  columnNumber: 25
                }, this)
              ] }, void 0, true, {
                fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
                lineNumber: 295,
                columnNumber: 23
              }, this),
              /* @__PURE__ */ jsxDEV("div", { className: "text-right", children: /* @__PURE__ */ jsxDEV("span", { className: `text-sm font-bold px-3 py-1.5 rounded-xl inline-block font-mono ${gradeBadgeClass}`, children: [
                grade.score,
                grade.maxScore != null ? `/${grade.maxScore}` : "/20"
              ] }, void 0, true, {
                fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
                lineNumber: 302,
                columnNumber: 25
              }, this) }, void 0, false, {
                fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
                lineNumber: 301,
                columnNumber: 23
              }, this)
            ] }, grade.id || i, true, {
              fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
              lineNumber: 294,
              columnNumber: 17
            }, this);
          })()
        ) : /* @__PURE__ */ jsxDEV("p", { className: "text-slate-400 py-4 text-center text-xs", children: "Aucune note saisie récemment." }, void 0, false, {
          fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
          lineNumber: 311,
          columnNumber: 13
        }, this) }, void 0, false, {
          fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
          lineNumber: 285,
          columnNumber: 11
        }, this)
      ] }, void 0, true, {
        fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
        lineNumber: 276,
        columnNumber: 9
      }, this)
    ] }, void 0, true, {
      fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
      lineNumber: 231,
      columnNumber: 7
    }, this)
  ] }, void 0, true, {
    fileName: "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx",
    lineNumber: 81,
    columnNumber: 5
  }, this);
}
_c = DashboardView;
var _c;
$RefreshReg$(_c, "DashboardView");
import * as RefreshRuntime from "/@react-refresh";
const inWebWorker = typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope;
if (import.meta.hot && !inWebWorker) {
  if (!window.$RefreshReg$) {
    throw new Error(
      "@vitejs/plugin-react can't detect preamble. Something is wrong."
    );
  }
  RefreshRuntime.__hmr_import(import.meta.url).then((currentExports) => {
    RefreshRuntime.registerExportsForReactRefresh("D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx", currentExports);
    import.meta.hot.accept((nextExports) => {
      if (!nextExports) return;
      const invalidateMessage = RefreshRuntime.validateRefreshBoundaryAndEnqueueUpdate("D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx", currentExports, nextExports);
      if (invalidateMessage) import.meta.hot.invalidate(invalidateMessage);
    });
  });
}
function $RefreshReg$(type, id) {
  return RefreshRuntime.register(type, "D:/Projet AYISSOU/web ecoles/src/components/DashboardView.tsx " + id);
}
function $RefreshSig$() {
  return RefreshRuntime.createSignatureFunctionForTransform();
}

//# sourceMappingURL=data:application/json;base64,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QUFBQTtBQUFBLGFBc0NBO0FBQUEsU0FuRkY7QUFBQTtBQUFBO0FBQUE7QUFBQSxXQW9GQTtBQUFBLE9BMU9GO0FBQUE7QUFBQTtBQUFBO0FBQUEsU0EyT0E7QUFFSjtBQUFDWSxLQXBRdUJwRDtBQUFhLElBQUFvRDtBQUFBLGFBQUFBLElBQUEiLCJuYW1lcyI6WyJVc2VycyIsIkFsZXJ0VHJpYW5nbGUiLCJQZXJjZW50IiwiR3JhZHVhdGlvbkNhcCIsIkNsb2NrIiwiQ2hlY2tDaXJjbGUiLCJYQ2lyY2xlIiwiQXdhcmQiLCJCYXJDaGFydCIsIkJhciIsIlhBeGlzIiwiWUF4aXMiLCJDYXJ0ZXNpYW5HcmlkIiwiVG9vbHRpcCIsIlJlc3BvbnNpdmVDb250YWluZXIiLCJMYWJlbExpc3QiLCJQaWVDaGFydCIsIlBpZSIsIkNlbGwiLCJnZXRHcmFkZUJhZGdlQ2xhc3MiLCJnZXRHcmFkZUJhbmQiLCJub3JtYWxpemVEYXNoYm9hcmRDaGFydERhdGEiLCJyYXdEYXRhIiwiQXJyYXkiLCJpc0FycmF5IiwicmVkdWNlIiwiYWNjIiwiaXRlbSIsInJlY29yZCIsIm5hbWUiLCJ0cmltIiwibGFiZWwiLCJjbGFzc05hbWUiLCJyYXdWYWx1ZSIsInRhdXgiLCJ2YWx1ZSIsImF0dGVuZGFuY2VSYXRlIiwicGVyY2VudCIsImNsYW1wZWRWYWx1ZSIsIk1hdGgiLCJtYXgiLCJtaW4iLCJOdW1iZXIiLCJwdXNoIiwiaXNGaW5pdGUiLCJEYXNoYm9hcmRWaWV3Iiwic3RhdHMiLCJyZWNlbnRBYnNlbmNlcyIsInJlY2VudEdyYWRlcyIsInVzZXJSb2xlIiwiY2hhcnREYXRhIiwiY29uc29sZSIsImxvZyIsInNsaWNlIiwiYXR0ZW5kYW5jZURhdGEiLCJqdXN0aWZpZWRDb3VudCIsImZpbHRlciIsImEiLCJpc0p1c3RpZmllZCIsImxlbmd0aCIsInVuanVzdGlmaWVkQ291bnQiLCJ0b3RhbEFic2VuY2VDb3VudCIsInBpZURhdGEiLCJjb2xvciIsInRvdGFsU3R1ZGVudHMiLCJtYWxlU3R1ZGVudHMiLCJmZW1hbGVTdHVkZW50cyIsInVua25vd25HZW5kZXJTdHVkZW50cyIsInRvdGFsQWJzZW5jZXMiLCJ0b3RhbENsYXNzZXMiLCJtaW5XaWR0aCIsIm1pbkhlaWdodCIsInRvcCIsInJpZ2h0IiwibGVmdCIsImJvdHRvbSIsImZpbGwiLCJmb250U2l6ZSIsImZvbnRXZWlnaHQiLCJtYXAiLCJlbnRyeSIsImluZGV4IiwiZCIsImJhY2tncm91bmRDb2xvciIsImFicyIsImkiLCJzdHVkZW50TmFtZSIsImRhdGUiLCJwZXJpb2QiLCJpZCIsImdyYWRlIiwibWF4U2NvcmUiLCJncmFkZUJhbmQiLCJzY29yZSIsImdyYWRlQmFkZ2VDbGFzcyIsInN1YmplY3QiLCJldmFsdWF0aW9uVGl0bGUiLCJfYyJdLCJpZ25vcmVMaXN0IjpbXSwic291cmNlcyI6WyJEYXNoYm9hcmRWaWV3LnRzeCJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgUmVhY3QgZnJvbSAncmVhY3QnO1xyXG5pbXBvcnQgeyBVc2VycywgQWxlcnRUcmlhbmdsZSwgUGVyY2VudCwgR3JhZHVhdGlvbkNhcCwgQ2xvY2ssIENoZWNrQ2lyY2xlLCBYQ2lyY2xlLCBBd2FyZCB9IGZyb20gJ2x1Y2lkZS1yZWFjdCc7XHJcbmltcG9ydCB7IEJhckNoYXJ0LCBCYXIsIFhBeGlzLCBZQXhpcywgQ2FydGVzaWFuR3JpZCwgVG9vbHRpcCwgUmVzcG9uc2l2ZUNvbnRhaW5lciwgTGFiZWxMaXN0LCBQaWVDaGFydCwgUGllLCBDZWxsIH0gZnJvbSAncmVjaGFydHMnO1xyXG5cclxuaW1wb3J0IHsgVXNlclJvbGUgfSBmcm9tICcuLi90eXBlcy50cyc7XHJcbmltcG9ydCB7IGdldEdyYWRlQmFkZ2VDbGFzcywgZ2V0R3JhZGVCYW5kIH0gZnJvbSAnLi4vbGliL2dyYWRlQ29sb3InO1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZURhc2hib2FyZENoYXJ0RGF0YShyYXdEYXRhOiB1bmtub3duKTogQXJyYXk8eyBuYW1lOiBzdHJpbmc7IHRhdXg6IG51bWJlciB9PiB7XHJcbiAgaWYgKCFBcnJheS5pc0FycmF5KHJhd0RhdGEpKSByZXR1cm4gW107XHJcblxyXG4gIHJldHVybiByYXdEYXRhLnJlZHVjZTxBcnJheTx7IG5hbWU6IHN0cmluZzsgdGF1eDogbnVtYmVyIH0+PigoYWNjLCBpdGVtKSA9PiB7XHJcbiAgICBpZiAoIWl0ZW0gfHwgdHlwZW9mIGl0ZW0gIT09ICdvYmplY3QnKSByZXR1cm4gYWNjO1xyXG5cclxuICAgIGNvbnN0IHJlY29yZCA9IGl0ZW0gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XHJcbiAgICBjb25zdCBuYW1lID0gdHlwZW9mIHJlY29yZC5uYW1lID09PSAnc3RyaW5nJyAmJiByZWNvcmQubmFtZS50cmltKClcclxuICAgICAgPyByZWNvcmQubmFtZS50cmltKClcclxuICAgICAgOiB0eXBlb2YgcmVjb3JkLmxhYmVsID09PSAnc3RyaW5nJyAmJiByZWNvcmQubGFiZWwudHJpbSgpXHJcbiAgICAgICAgPyByZWNvcmQubGFiZWwudHJpbSgpXHJcbiAgICAgICAgOiB0eXBlb2YgcmVjb3JkLmNsYXNzTmFtZSA9PT0gJ3N0cmluZycgJiYgcmVjb3JkLmNsYXNzTmFtZS50cmltKClcclxuICAgICAgICAgID8gcmVjb3JkLmNsYXNzTmFtZS50cmltKClcclxuICAgICAgICAgIDogbnVsbDtcclxuXHJcbiAgICBjb25zdCByYXdWYWx1ZSA9IHR5cGVvZiByZWNvcmQudGF1eCA9PT0gJ251bWJlcidcclxuICAgICAgPyByZWNvcmQudGF1eFxyXG4gICAgICA6IHR5cGVvZiByZWNvcmQudmFsdWUgPT09ICdudW1iZXInXHJcbiAgICAgICAgPyByZWNvcmQudmFsdWVcclxuICAgICAgICA6IHR5cGVvZiByZWNvcmQuYXR0ZW5kYW5jZVJhdGUgPT09ICdudW1iZXInXHJcbiAgICAgICAgICA/IHJlY29yZC5hdHRlbmRhbmNlUmF0ZVxyXG4gICAgICAgICAgOiB0eXBlb2YgcmVjb3JkLnBlcmNlbnQgPT09ICdudW1iZXInXHJcbiAgICAgICAgICAgID8gcmVjb3JkLnBlcmNlbnRcclxuICAgICAgICAgICAgOiBudWxsO1xyXG5cclxuICAgIGlmICghbmFtZSB8fCByYXdWYWx1ZSA9PSBudWxsKSByZXR1cm4gYWNjO1xyXG5cclxuICAgIGNvbnN0IGNsYW1wZWRWYWx1ZSA9IE1hdGgubWF4KDAsIE1hdGgubWluKDEwMCwgTnVtYmVyKHJhd1ZhbHVlKSkpO1xyXG4gICAgYWNjLnB1c2goeyBuYW1lLCB0YXV4OiBOdW1iZXIuaXNGaW5pdGUoY2xhbXBlZFZhbHVlKSA/IGNsYW1wZWRWYWx1ZSA6IDAgfSk7XHJcbiAgICByZXR1cm4gYWNjO1xyXG4gIH0sIFtdKTtcclxufVxyXG5cclxuaW50ZXJmYWNlIERhc2hib2FyZFZpZXdQcm9wcyB7XHJcbiAgc3RhdHM6IHtcclxuICAgIHRvdGFsU3R1ZGVudHM6IG51bWJlcjtcclxuICAgIHRvdGFsQWJzZW5jZXM6IG51bWJlcjtcclxuICAgIHRvdGFsQ2xhc3NlczogbnVtYmVyO1xyXG4gICAgdG90YWxUZWFjaGVyczogbnVtYmVyO1xyXG4gICAgYXR0ZW5kYW5jZVJhdGU6IG51bWJlcjtcclxuICAgIG1hbGVTdHVkZW50cz86IG51bWJlcjtcclxuICAgIGZlbWFsZVN0dWRlbnRzPzogbnVtYmVyO1xyXG4gICAgdW5rbm93bkdlbmRlclN0dWRlbnRzPzogbnVtYmVyO1xyXG4gIH07XHJcbiAgcmVjZW50QWJzZW5jZXM6IGFueVtdO1xyXG4gIHJlY2VudEdyYWRlczogYW55W107XHJcbiAgdXNlclJvbGU/OiBVc2VyUm9sZTtcclxuICBjaGFydERhdGE/OiBBcnJheTx7IG5hbWU6IHN0cmluZzsgdGF1eDogbnVtYmVyIH0+O1xyXG59XHJcblxyXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBEYXNoYm9hcmRWaWV3KHtcclxuICBzdGF0cyxcclxuICByZWNlbnRBYnNlbmNlcyxcclxuICByZWNlbnRHcmFkZXMsXHJcbiAgdXNlclJvbGUsXHJcbiAgY2hhcnREYXRhID0gW10sXHJcbn06IERhc2hib2FyZFZpZXdQcm9wcykge1xyXG4gIGNvbnNvbGUubG9nKCdTdGF0aXN0aXF1ZXMgcmXDp3VlcyBwYXIgRGFzaGJvYXJkVmlldyA6Jywgc3RhdHMpO1xyXG4gIGNvbnNvbGUubG9nKCdHcmFwaGlxdWUgcmXDp3UgOicsIGNoYXJ0RGF0YSk7XHJcbiAgY29uc29sZS5sb2coJ1RZUEUgY2hhcnREYXRhOicsIHR5cGVvZiBjaGFydERhdGEpO1xyXG4gIGNvbnNvbGUubG9nKCdJUyBBUlJBWTonLCBBcnJheS5pc0FycmF5KGNoYXJ0RGF0YSkpO1xyXG4gIGNvbnNvbGUubG9nKCdDT05URU5UIFNBTVBMRTonLCBjaGFydERhdGE/LnNsaWNlPy4oMCwgNSkpO1xyXG5cclxuICBjb25zdCBhdHRlbmRhbmNlRGF0YSA9IG5vcm1hbGl6ZURhc2hib2FyZENoYXJ0RGF0YShjaGFydERhdGEpO1xyXG4gIGNvbnN0IGp1c3RpZmllZENvdW50ID0gcmVjZW50QWJzZW5jZXMuZmlsdGVyKChhKSA9PiBhLmlzSnVzdGlmaWVkKS5sZW5ndGg7XHJcbiAgY29uc3QgdW5qdXN0aWZpZWRDb3VudCA9IHJlY2VudEFic2VuY2VzLmZpbHRlcigoYSkgPT4gIWEuaXNKdXN0aWZpZWQpLmxlbmd0aDtcclxuICBjb25zdCB0b3RhbEFic2VuY2VDb3VudCA9IGp1c3RpZmllZENvdW50ICsgdW5qdXN0aWZpZWRDb3VudDtcclxuICBjb25zdCBwaWVEYXRhID0gW1xyXG4gICAgeyBuYW1lOiAnSnVzdGlmacOpZXMnLCB2YWx1ZToganVzdGlmaWVkQ291bnQsIGNvbG9yOiAnIzEwYjk4MScgfSxcclxuICAgIHsgbmFtZTogJ05vbiBKdXN0aWZpw6llcycsIHZhbHVlOiB1bmp1c3RpZmllZENvdW50LCBjb2xvcjogJyNlZjQ0NDQnIH0sXHJcbiAgXTtcclxuXHJcbiAgcmV0dXJuIChcclxuICAgIDxkaXYgY2xhc3NOYW1lPVwic3BhY2UteS02XCIgaWQ9XCJkYXNoYm9hcmQtdmlld1wiPlxyXG4gICAgICA8ZGl2IGNsYXNzTmFtZT1cImZsZXgganVzdGlmeS1iZXR3ZWVuIGl0ZW1zLWNlbnRlclwiPlxyXG4gICAgICAgIDxkaXY+XHJcbiAgICAgICAgICA8aDIgY2xhc3NOYW1lPVwidGV4dC0yeGwgZm9udC1ib2xkIHRleHQtc2xhdGUtODAwXCI+VGFibGVhdSBkZSBCb3JkIEfDqW7DqXJhbDwvaDI+XHJcbiAgICAgICAgICA8cCBjbGFzc05hbWU9XCJ0ZXh0LXNtIHRleHQtc2xhdGUtNTAwXCI+U3RhdGlzdGlxdWVzIGRlIGZyw6lxdWVudGF0aW9uIGdsb2JhbGUgZXQgdnVlIGTigJllbnNlbWJsZSBlbiB0ZW1wcyByw6llbDwvcD5cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgPC9kaXY+XHJcblxyXG4gICAgICB7LyogR3JpZCBvZiBjb3VudGVycyAqL31cclxuICAgICAgPGRpdiBjbGFzc05hbWU9XCJncmlkIGdyaWQtY29scy0xIHNtOmdyaWQtY29scy0yIGxnOmdyaWQtY29scy0zIHhsOmdyaWQtY29scy00IGdhcC01XCI+XHJcbiAgICAgICAgXHJcbiAgICAgICAgey8qIFRvdGFsIFN0dWRlbnRzICovfVxyXG4gICAgICAgIDxkaXYgY2xhc3NOYW1lPVwiYmctd2hpdGUgcC01IHJvdW5kZWQtMnhsIGJvcmRlciBib3JkZXItc2xhdGUtMTAwIHNoYWRvdy1zbSBmbGV4IGl0ZW1zLWNlbnRlciBqdXN0aWZ5LWJldHdlZW5cIiBpZD1cImNhcmQtc3RhdHMtc3R1ZGVudHNcIj5cclxuICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPVwic3BhY2UteS0xXCI+XHJcbiAgICAgICAgICAgIDxzcGFuIGNsYXNzTmFtZT1cInRleHQteHMgZm9udC1zZW1pYm9sZCB0ZXh0LXNsYXRlLTQwMCB1cHBlcmNhc2UgdHJhY2tpbmctd2lkZXJcIj5FZmZlY3RpZiBUb3RhbDwvc3Bhbj5cclxuICAgICAgICAgICAgPHAgY2xhc3NOYW1lPVwidGV4dC0zeGwgZm9udC1ib2xkIHRleHQtc2xhdGUtODAwXCI+e3N0YXRzLnRvdGFsU3R1ZGVudHN9PC9wPlxyXG4gICAgICAgICAgICA8cCBjbGFzc05hbWU9XCJ0ZXh0LXhzIHRleHQtaW5kaWdvLTUwMCBmb250LXNlbWlib2xkIHRyYWNraW5nLXRpZ2h0XCI+w4lsw6h2ZXMgaW5zY3JpdHM8L3A+XHJcbiAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPVwicC0zIGJnLWluZGlnby01MCB0ZXh0LWluZGlnby02MDAgcm91bmRlZC14bFwiPlxyXG4gICAgICAgICAgICA8VXNlcnMgY2xhc3NOYW1lPVwiaC02IHctNlwiIC8+XHJcbiAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICA8L2Rpdj5cclxuXHJcbiAgICAgICAgey8qIEdlbmRlciBEaXN0cmlidXRpb24gKi99XHJcbiAgICAgICAge3VzZXJSb2xlICE9PSAncGFyZW50JyAmJiAoXHJcbiAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT1cImJnLXdoaXRlIHAtNSByb3VuZGVkLTJ4bCBib3JkZXIgYm9yZGVyLXNsYXRlLTEwMCBzaGFkb3ctc21cIiBpZD1cImNhcmQtc3RhdHMtZ2VuZGVyXCI+XHJcbiAgICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPVwic3BhY2UteS00XCI+XHJcbiAgICAgICAgICAgICAgPHNwYW4gY2xhc3NOYW1lPVwidGV4dC14cyBmb250LXNlbWlib2xkIHRleHQtc2xhdGUtNDAwIHVwcGVyY2FzZSB0cmFja2luZy13aWRlclwiPlLDqXBhcnRpdGlvbiBwYXIgZ2VucmU8L3NwYW4+XHJcbiAgICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9XCJncmlkIGdyaWQtY29scy0yIGdhcC0zXCI+XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT1cImJnLXNsYXRlLTUwIHJvdW5kZWQtMnhsIHAtNFwiPlxyXG4gICAgICAgICAgICAgICAgICA8cCBjbGFzc05hbWU9XCJ0ZXh0LXhzIHRleHQtc2xhdGUtNTAwIHVwcGVyY2FzZSB0cmFja2luZy13aWRlclwiPkdhcsOnb25zPC9wPlxyXG4gICAgICAgICAgICAgICAgICA8cCBjbGFzc05hbWU9XCJ0ZXh0LTJ4bCBmb250LWJvbGQgdGV4dC1zbGF0ZS04MDBcIj57c3RhdHMubWFsZVN0dWRlbnRzIHx8IDB9PC9wPlxyXG4gICAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT1cImJnLXNsYXRlLTUwIHJvdW5kZWQtMnhsIHAtNFwiPlxyXG4gICAgICAgICAgICAgICAgICA8cCBjbGFzc05hbWU9XCJ0ZXh0LXhzIHRleHQtc2xhdGUtNTAwIHVwcGVyY2FzZSB0cmFja2luZy13aWRlclwiPkZpbGxlczwvcD5cclxuICAgICAgICAgICAgICAgICAgPHAgY2xhc3NOYW1lPVwidGV4dC0yeGwgZm9udC1ib2xkIHRleHQtc2xhdGUtODAwXCI+e3N0YXRzLmZlbWFsZVN0dWRlbnRzIHx8IDB9PC9wPlxyXG4gICAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAge3N0YXRzLnVua25vd25HZW5kZXJTdHVkZW50cyAmJiBzdGF0cy51bmtub3duR2VuZGVyU3R1ZGVudHMgPiAwICYmIChcclxuICAgICAgICAgICAgICAgIDxwIGNsYXNzTmFtZT1cInRleHQtWzExcHhdIHRleHQtc2xhdGUtNTAwXCI+e3N0YXRzLnVua25vd25HZW5kZXJTdHVkZW50c30gbm9uIHJlbnNlaWduw6l7c3RhdHMudW5rbm93bkdlbmRlclN0dWRlbnRzID4gMSA/ICdzJyA6ICcnfTwvcD5cclxuICAgICAgICAgICAgICApfVxyXG4gICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICl9XHJcblxyXG4gICAgICAgIHsvKiBUb3RhbCBBYnNlbmNlcyAqL31cclxuICAgICAgICA8ZGl2IGNsYXNzTmFtZT1cImJnLXdoaXRlIHAtNSByb3VuZGVkLTJ4bCBib3JkZXIgYm9yZGVyLXNsYXRlLTEwMCBzaGFkb3ctc20gZmxleCBpdGVtcy1jZW50ZXIganVzdGlmeS1iZXR3ZWVuXCIgaWQ9XCJjYXJkLXN0YXRzLWFic2VuY2VzXCI+XHJcbiAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT1cInNwYWNlLXktMVwiPlxyXG4gICAgICAgICAgICA8c3BhbiBjbGFzc05hbWU9XCJ0ZXh0LXhzIGZvbnQtc2VtaWJvbGQgdGV4dC1zbGF0ZS00MDAgdXBwZXJjYXNlIHRyYWNraW5nLXdpZGVyXCI+QWJzZW5jZXMgZW5yZWdpc3Ryw6llczwvc3Bhbj5cclxuICAgICAgICAgICAgPHAgY2xhc3NOYW1lPVwidGV4dC0zeGwgZm9udC1ib2xkIHRleHQtc2xhdGUtODAwXCI+e3N0YXRzLnRvdGFsQWJzZW5jZXN9PC9wPlxyXG4gICAgICAgICAgICA8cCBjbGFzc05hbWU9XCJ0ZXh0LXhzIHRleHQtcm9zZS01MDAgZm9udC1zZW1pYm9sZCB0cmFja2luZy10aWdodFwiPkRlcHVpcyBs4oCZb3V2ZXJ0dXJlIGRlIGzigJlhbm7DqWU8L3A+XHJcbiAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPVwicC0zIGJnLXJvc2UtNTAgdGV4dC1yb3NlLTYwMCByb3VuZGVkLXhsXCI+XHJcbiAgICAgICAgICAgIDxBbGVydFRyaWFuZ2xlIGNsYXNzTmFtZT1cImgtNiB3LTZcIiAvPlxyXG4gICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgPC9kaXY+XHJcblxyXG4gICAgICAgIHsvKiBBdHRlbmRhbmNlIFJhdGUgKi99XHJcbiAgICAgICAgPGRpdiBjbGFzc05hbWU9XCJiZy13aGl0ZSBwLTUgcm91bmRlZC0yeGwgYm9yZGVyIGJvcmRlci1zbGF0ZS0xMDAgc2hhZG93LXNtIGZsZXggaXRlbXMtY2VudGVyIGp1c3RpZnktYmV0d2VlblwiIGlkPVwiY2FyZC1zdGF0cy1yYXRlXCI+XHJcbiAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT1cInNwYWNlLXktMVwiPlxyXG4gICAgICAgICAgICA8c3BhbiBjbGFzc05hbWU9XCJ0ZXh0LXhzIGZvbnQtc2VtaWJvbGQgdGV4dC1zbGF0ZS00MDAgdXBwZXJjYXNlIHRyYWNraW5nLXdpZGVyXCI+VGF1eCBkZSBGcsOpcXVlbnRhdGlvbjwvc3Bhbj5cclxuICAgICAgICAgICAgPHAgY2xhc3NOYW1lPVwidGV4dC0zeGwgZm9udC1ib2xkIHRleHQtc2xhdGUtODAwXCI+e3N0YXRzLmF0dGVuZGFuY2VSYXRlfSU8L3A+XHJcbiAgICAgICAgICAgIDxwIGNsYXNzTmFtZT1cInRleHQteHMgdGV4dC1lbWVyYWxkLTUwMCBmb250LXNlbWlib2xkIHRyYWNraW5nLXRpZ2h0XCI+VGF1eCBtb3llbiBkZSBwcsOpc2VuY2U8L3A+XHJcbiAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgIDxkaXYgY2xhc3NOYW1lPVwicC0zIGJnLWVtZXJhbGQtNTAgdGV4dC1lbWVyYWxkLTYwMCByb3VuZGVkLXhsXCI+XHJcbiAgICAgICAgICAgIDxQZXJjZW50IGNsYXNzTmFtZT1cImgtNiB3LTZcIiAvPlxyXG4gICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgPC9kaXY+XHJcblxyXG4gICAgICAgIHsvKiBDbGFzc2VzIEluZm8gKi99XHJcbiAgICAgICAgPGRpdiBjbGFzc05hbWU9XCJiZy13aGl0ZSBwLTUgcm91bmRlZC0yeGwgYm9yZGVyIGJvcmRlci1zbGF0ZS0xMDAgc2hhZG93LXNtIGZsZXggaXRlbXMtY2VudGVyIGp1c3RpZnktYmV0d2VlblwiIGlkPVwiY2FyZC1zdGF0cy1jbGFzc2VzXCI+XHJcbiAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT1cInNwYWNlLXktMVwiPlxyXG4gICAgICAgICAgICA8c3BhbiBjbGFzc05hbWU9XCJ0ZXh0LXhzIGZvbnQtc2VtaWJvbGQgdGV4dC1zbGF0ZS00MDAgdXBwZXJjYXNlIHRyYWNraW5nLXdpZGVyXCI+Q2xhc3NlcyAmIEFjdGV1cnM8L3NwYW4+XHJcbiAgICAgICAgICAgIDxwIGNsYXNzTmFtZT1cInRleHQtM3hsIGZvbnQtYm9sZCB0ZXh0LXNsYXRlLTgwMFwiPntzdGF0cy50b3RhbENsYXNzZXN9PC9wPlxyXG4gICAgICAgICAgICA8cCBjbGFzc05hbWU9XCJ0ZXh0LXhzIHRleHQtc2xhdGUtNTAwXCI+RGl2aXNpb25zIGRlIGzigJnDqXRhYmxpc3NlbWVudDwvcD5cclxuICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgPGRpdiBjbGFzc05hbWU9XCJwLTMgYmctYW1iZXItNTAgdGV4dC1hbWJlci02MDAgcm91bmRlZC14bFwiPlxyXG4gICAgICAgICAgICA8R3JhZHVhdGlvbkNhcCBjbGFzc05hbWU9XCJoLTYgdy02XCIgLz5cclxuICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgICA8L2Rpdj5cclxuXHJcbiAgICAgIHsvKiBDaGFydHMgc2VjdGlvbiAqL31cclxuICAgICAgPGRpdiBjbGFzc05hbWU9XCJncmlkIGdyaWQtY29scy0xIGdhcC02XCI+XHJcbiAgICAgICAge3VzZXJSb2xlICE9PSAncGFyZW50JyAmJiAoXHJcbiAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT1cImJnLXdoaXRlIHAtNSByb3VuZGVkLTJ4bCBib3JkZXIgYm9yZGVyLXNsYXRlLTEwMCBzaGFkb3ctc20gc3BhY2UteS00XCI+XHJcbiAgICAgICAgICAgIDxkaXY+XHJcbiAgICAgICAgICAgICAgPGgzIGNsYXNzTmFtZT1cImZvbnQtYm9sZCB0ZXh0LXNsYXRlLTgwMFwiPkZyw6lxdWVudGF0aW9uIHBhciBEaXZpc2lvbiAoJSk8L2gzPlxyXG4gICAgICAgICAgICAgIDxwIGNsYXNzTmFtZT1cInRleHQteHMgdGV4dC1zbGF0ZS00MDBcIj5UYXV4IG1veWVuIGRlIHByw6lzZW5jZSBwb3VyIGxlcyBjbGFzc2VzIHByaW5jaXBhbGVzPC9wPlxyXG4gICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9XCJoLTY0IHdjLWNoYXJ0XCIgc3R5bGU9e3sgbWluV2lkdGg6IDAsIG1pbkhlaWdodDogMCB9fT5cclxuICAgICAgICAgICAgICA8UmVzcG9uc2l2ZUNvbnRhaW5lciB3aWR0aD1cIjEwMCVcIiBoZWlnaHQ9XCIxMDAlXCI+XHJcbiAgICAgICAgICAgICAgICA8QmFyQ2hhcnQgZGF0YT17YXR0ZW5kYW5jZURhdGF9IG1hcmdpbj17eyB0b3A6IDIwLCByaWdodDogMTAsIGxlZnQ6IC0yMCwgYm90dG9tOiA1IH19PlxyXG4gICAgICAgICAgICAgICAgICA8Q2FydGVzaWFuR3JpZCBzdHJva2VEYXNoYXJyYXk9XCIzIDNcIiB2ZXJ0aWNhbD17ZmFsc2V9IHN0cm9rZT1cIiNmMWY1ZjlcIiAvPlxyXG4gICAgICAgICAgICAgICAgICA8WEF4aXMgZGF0YUtleT1cIm5hbWVcIiB0aWNrPXt7IGZpbGw6ICcjNjQ3NDhiJywgZm9udFNpemU6IDExIH19IC8+XHJcbiAgICAgICAgICAgICAgICAgIDxZQXhpcyBkb21haW49e1swLCAxMDBdfSB0aWNrPXt7IGZpbGw6ICcjNjQ3NDhiJywgZm9udFNpemU6IDExIH19IC8+XHJcbiAgICAgICAgICAgICAgICAgIDxUb29sdGlwIGN1cnNvcj17eyBmaWxsOiAnI2Y4ZmFmYycgfX0gLz5cclxuICAgICAgICAgICAgICAgICAgPEJhciBkYXRhS2V5PVwidGF1eFwiIGZpbGw9XCIjNGY0NmU1XCIgcmFkaXVzPXtbNiwgNiwgMCwgMF19PlxyXG4gICAgICAgICAgICAgICAgICAgIDxMYWJlbExpc3QgZGF0YUtleT1cInRhdXhcIiBwb3NpdGlvbj1cInRvcFwiIHN0eWxlPXt7IGZvbnRTaXplOiAxMSwgZmlsbDogJyM2NDc0OGInLCBmb250V2VpZ2h0OiAnYm9sZCcgfX0gLz5cclxuICAgICAgICAgICAgICAgICAgPC9CYXI+XHJcbiAgICAgICAgICAgICAgICA8L0JhckNoYXJ0PlxyXG4gICAgICAgICAgICAgIDwvUmVzcG9uc2l2ZUNvbnRhaW5lcj5cclxuICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICApfVxyXG4gICAgICAgIHsvKiBKdXN0aWZpY2F0aW9ucyBwaWUgY2hhcnQgKi99XHJcbiAgICAgICAgPGRpdiBjbGFzc05hbWU9XCJiZy13aGl0ZSBwLTUgcm91bmRlZC0yeGwgYm9yZGVyIGJvcmRlci1zbGF0ZS0xMDAgc2hhZG93LXNtIHNwYWNlLXktNFwiPlxyXG4gICAgICAgICAgPGRpdj5cclxuICAgICAgICAgICAgPGgzIGNsYXNzTmFtZT1cImZvbnQtYm9sZCB0ZXh0LXNsYXRlLTgwMFwiPlN0YXR1dCBkZXMgQWJzZW5jZXM8L2gzPlxyXG4gICAgICAgICAgICA8cCBjbGFzc05hbWU9XCJ0ZXh0LXhzIHRleHQtc2xhdGUtNDAwXCI+UsOpcGFydGl0aW9uIGVudHJlIGFic2VuY2VzIGTDqWNsYXLDqWVzIGV0IGp1c3RpZmnDqWVzPC9wPlxyXG4gICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT1cImgtNDQgZmxleCBpdGVtcy1jZW50ZXIganVzdGlmeS1jZW50ZXIgcmVsYXRpdmVcIiBzdHlsZT17eyBtaW5XaWR0aDogMCwgbWluSGVpZ2h0OiAwIH19PlxyXG4gICAgICAgICAgICA8UmVzcG9uc2l2ZUNvbnRhaW5lciB3aWR0aD1cIjEwMCVcIiBoZWlnaHQ9XCIxMDAlXCI+XHJcbiAgICAgICAgICAgICAgPFBpZUNoYXJ0PlxyXG4gICAgICAgICAgICAgICAgPFBpZVxyXG4gICAgICAgICAgICAgICAgICBkYXRhPXtwaWVEYXRhfVxyXG4gICAgICAgICAgICAgICAgICBjeD1cIjUwJVwiXHJcbiAgICAgICAgICAgICAgICAgIGN5PVwiNTAlXCJcclxuICAgICAgICAgICAgICAgICAgaW5uZXJSYWRpdXM9ezUwfVxyXG4gICAgICAgICAgICAgICAgICBvdXRlclJhZGl1cz17NzV9XHJcbiAgICAgICAgICAgICAgICAgIHBhZGRpbmdBbmdsZT17NX1cclxuICAgICAgICAgICAgICAgICAgZGF0YUtleT1cInZhbHVlXCJcclxuICAgICAgICAgICAgICAgID5cclxuICAgICAgICAgICAgICAgICAge3BpZURhdGEubWFwKChlbnRyeSwgaW5kZXgpID0+IChcclxuICAgICAgICAgICAgICAgICAgICA8Q2VsbCBrZXk9e2BjZWxsLSR7aW5kZXh9YH0gZmlsbD17ZW50cnkuY29sb3J9IC8+XHJcbiAgICAgICAgICAgICAgICAgICkpfVxyXG4gICAgICAgICAgICAgICAgPC9QaWU+XHJcbiAgICAgICAgICAgICAgICA8VG9vbHRpcCAvPlxyXG4gICAgICAgICAgICAgIDwvUGllQ2hhcnQ+XHJcbiAgICAgICAgICAgIDwvUmVzcG9uc2l2ZUNvbnRhaW5lcj5cclxuICAgICAgICAgICAgPGRpdiBjbGFzc05hbWU9XCJhYnNvbHV0ZSB0ZXh0LWNlbnRlclwiPlxyXG4gICAgICAgICAgICAgIDxzcGFuIGNsYXNzTmFtZT1cInRleHQteHMgdGV4dC1zbGF0ZS00MDAgdXBwZXJjYXNlIGZvbnQtYm9sZCB0cmFja2luZy13aWRlclwiPlRvdGFsPC9zcGFuPlxyXG4gICAgICAgICAgICAgIDxwIGNsYXNzTmFtZT1cInRleHQteGwgZm9udC1ibGFjayB0ZXh0LXNsYXRlLTgwMFwiPnt0b3RhbEFic2VuY2VDb3VudH08L3A+XHJcbiAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT1cInNwYWNlLXktMiBwdC0yIGJvcmRlci10IGJvcmRlci1zbGF0ZS0xMDBcIj5cclxuICAgICAgICAgICAge3BpZURhdGEubWFwKChkKSA9PiAoXHJcbiAgICAgICAgICAgICAgPGRpdiBrZXk9e2QubmFtZX0gY2xhc3NOYW1lPVwiZmxleCBqdXN0aWZ5LWJldHdlZW4gaXRlbXMtY2VudGVyIHRleHQteHNcIj5cclxuICAgICAgICAgICAgICAgIDxzcGFuIGNsYXNzTmFtZT1cImZsZXggaXRlbXMtY2VudGVyIGdhcC0yIHRleHQtc2xhdGUtNTAwIHRleHQteHNcIj5cclxuICAgICAgICAgICAgICAgICAgPHNwYW4gY2xhc3NOYW1lPVwidy0zIGgtMyByb3VuZGVkLWZ1bGwgaW5saW5lLWJsb2NrXCIgc3R5bGU9e3sgYmFja2dyb3VuZENvbG9yOiBkLmNvbG9yIH19IC8+XHJcbiAgICAgICAgICAgICAgICAgIHtkLm5hbWV9XHJcbiAgICAgICAgICAgICAgICA8L3NwYW4+XHJcbiAgICAgICAgICAgICAgICA8c3BhbiBjbGFzc05hbWU9XCJmb250LWJvbGQgdGV4dC1zbGF0ZS04MDBcIj57ZC52YWx1ZX08L3NwYW4+XHJcbiAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICkpfVxyXG4gICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgIDwvZGl2PlxyXG5cclxuICAgICAgey8qIFJlY2VudCBhY3Rpdml0aWVzIHNlY3Rpb24gKi99XHJcbiAgICAgIDxkaXYgY2xhc3NOYW1lPVwiZ3JpZCBncmlkLWNvbHMtMSBsZzpncmlkLWNvbHMtMiBnYXAtNlwiPlxyXG4gICAgICAgIFxyXG4gICAgICAgIHsvKiBSZWNlbnQgYWJzZW5jZXMgbGlzdCAqL31cclxuICAgICAgICA8ZGl2IGNsYXNzTmFtZT1cImJnLXdoaXRlIHAtNSByb3VuZGVkLTJ4bCBib3JkZXIgYm9yZGVyLXNsYXRlLTEwMCBzaGFkb3ctc20gc3BhY2UteS00XCI+XHJcbiAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT1cImZsZXgganVzdGlmeS1iZXR3ZWVuIGl0ZW1zLWNlbnRlclwiPlxyXG4gICAgICAgICAgICA8aDMgY2xhc3NOYW1lPVwiZm9udC1ib2xkIHRleHQtc2xhdGUtODAwIGZsZXggaXRlbXMtY2VudGVyIGdhcC0yXCI+XHJcbiAgICAgICAgICAgICAgPENsb2NrIGNsYXNzTmFtZT1cImgtNSB3LTUgdGV4dC1pbmRpZ28tNTAwXCIgLz5cclxuICAgICAgICAgICAgICBBYnNlbmNlcyBTaWduYWzDqWVzIFLDqWNlbW1lbnRcclxuICAgICAgICAgICAgPC9oMz5cclxuICAgICAgICAgICAgPHNwYW4gY2xhc3NOYW1lPVwidGV4dC14cyBiZy1zbGF0ZS01MCB0ZXh0LXNsYXRlLTUwMCBmb250LXNlbWlib2xkIHB4LTIgcHktMSByb3VuZGVkLWxnXCI+VGVtcHMgUsOpZWw8L3NwYW4+XHJcbiAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgIFxyXG4gICAgICAgICAgPGRpdiBjbGFzc05hbWU9XCJkaXZpZGUteSBkaXZpZGUtc2xhdGUtNTBcIj5cclxuICAgICAgICAgICAge3JlY2VudEFic2VuY2VzICYmIHJlY2VudEFic2VuY2VzLmxlbmd0aCA+IDAgPyAoXHJcbiAgICAgICAgICAgICAgcmVjZW50QWJzZW5jZXMubWFwKChhYnMsIGkpID0+IChcclxuICAgICAgICAgICAgICAgIDxkaXYga2V5PXthYnMuaWQgfHwgaX0gY2xhc3NOYW1lPVwicHktMyBmbGV4IGl0ZW1zLWNlbnRlciBqdXN0aWZ5LWJldHdlZW4gdGV4dC14cyBzbTp0ZXh0LXNtXCI+XHJcbiAgICAgICAgICAgICAgICAgIDxkaXY+XHJcbiAgICAgICAgICAgICAgICAgICAgPHAgY2xhc3NOYW1lPVwiZm9udC1ib2xkIHRleHQtc2xhdGUtODAwXCI+e2Ficy5zdHVkZW50TmFtZX08L3A+XHJcbiAgICAgICAgICAgICAgICAgICAgPHAgY2xhc3NOYW1lPVwidGV4dC14cyB0ZXh0LXNsYXRlLTQwMFwiPkNsYXNzZSA6IHthYnMuY2xhc3NOYW1lfSDigKIgRGF0ZSA6IHthYnMuZGF0ZX08L3A+XHJcbiAgICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT1cImZsZXggaXRlbXMtY2VudGVyIGdhcC0yXCI+XHJcbiAgICAgICAgICAgICAgICAgICAgPHNwYW4gY2xhc3NOYW1lPVwidGV4dC14cyB0ZXh0LXNsYXRlLTUwMCBjYXBpdGFsaXplIGJnLXNsYXRlLTEwMCBweC0yLjUgcHktMSByb3VuZGVkLW1kXCI+XHJcbiAgICAgICAgICAgICAgICAgICAgICB7YWJzLnBlcmlvZCA9PT0gJ21vcm5pbmcnID8gJ01hdGluJyA6IGFicy5wZXJpb2QgPT09ICdhZnRlcm5vb24nID8gJ0FwcsOocy1taWRpJyA6ICdKb3VybsOpZSd9XHJcbiAgICAgICAgICAgICAgICAgICAgPC9zcGFuPlxyXG4gICAgICAgICAgICAgICAgICAgIHthYnMuaXNKdXN0aWZpZWQgPyAoXHJcbiAgICAgICAgICAgICAgICAgICAgICA8c3BhbiBjbGFzc05hbWU9XCJmbGV4IGl0ZW1zLWNlbnRlciBnYXAtMSB0ZXh0LWVtZXJhbGQtNjAwIGJnLWVtZXJhbGQtNTAgcHgtMiBweS0xIHJvdW5kZWQtbGcgZm9udC1ib2xkIHRleHQteHNcIj5cclxuICAgICAgICAgICAgICAgICAgICAgICAgPENoZWNrQ2lyY2xlIGNsYXNzTmFtZT1cImgtMyB3LTNcIiAvPlxyXG4gICAgICAgICAgICAgICAgICAgICAgICBKdXN0aWZpw6llXHJcbiAgICAgICAgICAgICAgICAgICAgICA8L3NwYW4+XHJcbiAgICAgICAgICAgICAgICAgICAgKSA6IChcclxuICAgICAgICAgICAgICAgICAgICAgIDxzcGFuIGNsYXNzTmFtZT1cImZsZXggaXRlbXMtY2VudGVyIGdhcC0xIHRleHQtcm9zZS02MDAgYmctcm9zZS01MCBweC0yIHB5LTEgcm91bmRlZC1sZyBmb250LWJvbGQgdGV4dC14c1wiPlxyXG4gICAgICAgICAgICAgICAgICAgICAgICA8WENpcmNsZSBjbGFzc05hbWU9XCJoLTMgdy0zXCIgLz5cclxuICAgICAgICAgICAgICAgICAgICAgICAgQSBKdXN0aWZpZXJcclxuICAgICAgICAgICAgICAgICAgICAgIDwvc3Bhbj5cclxuICAgICAgICAgICAgICAgICAgICApfVxyXG4gICAgICAgICAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgICkpXHJcbiAgICAgICAgICAgICkgOiAoXHJcbiAgICAgICAgICAgICAgPHAgY2xhc3NOYW1lPVwidGV4dC1zbGF0ZS00MDAgcHktNCB0ZXh0LWNlbnRlciB0ZXh0LXhzXCI+QXVjdW5lIGFic2VuY2UgZW5yZWdpc3Ryw6llIGNlcyBkZXJuaWVycyBqb3Vycy48L3A+XHJcbiAgICAgICAgICAgICl9XHJcbiAgICAgICAgICA8L2Rpdj5cclxuICAgICAgICA8L2Rpdj5cclxuXHJcbiAgICAgICAgey8qIFJlY2VudCBncmFkZXMgbGlzdCAqL31cclxuICAgICAgICA8ZGl2IGNsYXNzTmFtZT1cImJnLXdoaXRlIHAtNSByb3VuZGVkLTJ4bCBib3JkZXIgYm9yZGVyLXNsYXRlLTEwMCBzaGFkb3ctc20gc3BhY2UteS00XCI+XHJcbiAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT1cImZsZXgganVzdGlmeS1iZXR3ZWVuIGl0ZW1zLWNlbnRlclwiPlxyXG4gICAgICAgICAgICA8aDMgY2xhc3NOYW1lPVwiZm9udC1ib2xkIHRleHQtc2xhdGUtODAwIGZsZXggaXRlbXMtY2VudGVyIGdhcC0yXCI+XHJcbiAgICAgICAgICAgICAgPEF3YXJkIGNsYXNzTmFtZT1cImgtNSB3LTUgdGV4dC1pbmRpZ28tNTAwXCIgLz5cclxuICAgICAgICAgICAgICBEZXJuacOocmVzIMOJdmFsdWF0aW9ucyAmIE5vdGVzXHJcbiAgICAgICAgICAgIDwvaDM+XHJcbiAgICAgICAgICAgIDxzcGFuIGNsYXNzTmFtZT1cInRleHQteHMgYmctZW1lcmFsZC01MCB0ZXh0LWVtZXJhbGQtNjAwIHB4LTIgcHktMSByb3VuZGVkLWxnIGZvbnQtc2VtaWJvbGRcIj5QdWJsacOpZXM8L3NwYW4+XHJcbiAgICAgICAgICA8L2Rpdj5cclxuXHJcbiAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT1cImRpdmlkZS15IGRpdmlkZS1zbGF0ZS01MFwiPlxyXG4gICAgICAgICAgICB7cmVjZW50R3JhZGVzICYmIHJlY2VudEdyYWRlcy5sZW5ndGggPiAwID8gKFxyXG4gICAgICAgICAgICAgIHJlY2VudEdyYWRlcy5tYXAoKGdyYWRlLCBpKSA9PiAoXHJcbiAgICAgICAgICAgICAgICAoKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICBjb25zdCBtYXhTY29yZSA9IGdyYWRlLm1heFNjb3JlICE9IG51bGwgPyBOdW1iZXIoZ3JhZGUubWF4U2NvcmUpIDogMjA7XHJcbiAgICAgICAgICAgICAgICAgIGNvbnN0IGdyYWRlQmFuZCA9IGdldEdyYWRlQmFuZChncmFkZS5zY29yZSwgbWF4U2NvcmUpO1xyXG4gICAgICAgICAgICAgICAgICBjb25zdCBncmFkZUJhZGdlQ2xhc3MgPSBnZXRHcmFkZUJhZGdlQ2xhc3MoZ3JhZGVCYW5kKTtcclxuXHJcbiAgICAgICAgICAgICAgICAgIHJldHVybiAoXHJcbiAgICAgICAgICAgICAgICAgICAgPGRpdiBrZXk9e2dyYWRlLmlkIHx8IGl9IGNsYXNzTmFtZT1cInB5LTMgZmxleCBpdGVtcy1jZW50ZXIganVzdGlmeS1iZXR3ZWVuIHRleHQteHMgc206dGV4dC1zbVwiPlxyXG4gICAgICAgICAgICAgICAgICAgICAgPGRpdj5cclxuICAgICAgICAgICAgICAgICAgICAgICAgPHAgY2xhc3NOYW1lPVwiZm9udC1ib2xkIHRleHQtc2xhdGUtODAwXCI+e2dyYWRlLnN0dWRlbnROYW1lfTwvcD5cclxuICAgICAgICAgICAgICAgICAgICAgICAgPHAgY2xhc3NOYW1lPVwidGV4dC14cyB0ZXh0LXNsYXRlLTQwMFwiPlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHtncmFkZS5zdWJqZWN0fSDigKIge2dyYWRlLmV2YWx1YXRpb25UaXRsZSB8fCAnRGV2b2lyJ31cclxuICAgICAgICAgICAgICAgICAgICAgICAgPC9wPlxyXG4gICAgICAgICAgICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzTmFtZT1cInRleHQtcmlnaHRcIj5cclxuICAgICAgICAgICAgICAgICAgICAgICAgPHNwYW4gY2xhc3NOYW1lPXtgdGV4dC1zbSBmb250LWJvbGQgcHgtMyBweS0xLjUgcm91bmRlZC14bCBpbmxpbmUtYmxvY2sgZm9udC1tb25vICR7Z3JhZGVCYWRnZUNsYXNzfWB9PlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHtncmFkZS5zY29yZX17Z3JhZGUubWF4U2NvcmUgIT0gbnVsbCA/IGAvJHtncmFkZS5tYXhTY29yZX1gIDogJy8yMCd9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIDwvc3Bhbj5cclxuICAgICAgICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgICAgICAgICApO1xyXG4gICAgICAgICAgICAgICAgfSkoKVxyXG4gICAgICAgICAgICAgICkpXHJcbiAgICAgICAgICAgICkgOiAoXHJcbiAgICAgICAgICAgICAgPHAgY2xhc3NOYW1lPVwidGV4dC1zbGF0ZS00MDAgcHktNCB0ZXh0LWNlbnRlciB0ZXh0LXhzXCI+QXVjdW5lIG5vdGUgc2Fpc2llIHLDqWNlbW1lbnQuPC9wPlxyXG4gICAgICAgICAgICApfVxyXG4gICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgIDwvZGl2PlxyXG4gICAgPC9kaXY+XHJcbiAgKTtcclxufVxyXG4iXSwiZmlsZSI6IkQ6L1Byb2pldCBBWUlTU09VL3dlYiBlY29sZXMvc3JjL2NvbXBvbmVudHMvRGFzaGJvYXJkVmlldy50c3gifQ==