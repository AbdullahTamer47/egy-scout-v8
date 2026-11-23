"use client";

import React, { useEffect, useRef } from "react";
import * as echarts from "echarts";
import type { ScoutingPlayer, TimelineFrame } from "@/lib/api";

const RADAR_COLORS = ["#10B981", "#38BDF8", "#F59E0B", "#F472B6"];

export function EChartsPlayerRadar({
  players,
  lang,
}: {
  players: ScoutingPlayer[];
  lang: "ar" | "en";
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    if (!chartRef.current) {
      chartRef.current = echarts.init(el, undefined, { renderer: "canvas" });
    }
    const chart = chartRef.current;
    const isAr = lang === "ar";

    const option: echarts.EChartsOption = {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item",
        backgroundColor: "rgba(9, 13, 22, 0.94)",
        borderColor: "rgba(255,255,255,0.14)",
        textStyle: { color: "#F8FAFC", fontSize: 11 },
      },
      legend: {
        bottom: 0,
        textStyle: { color: "#CBD5E1", fontSize: 11 },
        itemWidth: 10,
        itemHeight: 10,
      },
      radar: {
        radius: "64%",
        center: ["50%", "44%"],
        splitNumber: 4,
        axisName: { color: "#94A3B8", fontSize: 10, fontWeight: 600 },
        splitLine: { lineStyle: { color: "rgba(255,255,255,0.09)" } },
        splitArea: { areaStyle: { color: ["rgba(16,185,129,0.02)", "rgba(255,255,255,0.01)"] } },
        axisLine: { lineStyle: { color: "rgba(255,255,255,0.1)" } },
        indicator: [
          { name: "VAEP/90", max: 0.6 },
          { name: "xT/90", max: 0.4 },
          { name: "%Team xT", max: 25 },
          { name: "PAdj Def", max: 16 },
          { name: "HIR (m)", max: 1150 },
          { name: isAr ? "الانضباط" : "Discipline", max: 100 },
        ],
      },
      series: [
        {
          type: "radar",
          symbolSize: 5,
          data: players.map((p, idx) => {
            const c = RADAR_COLORS[idx % RADAR_COLORS.length];
            const disc = p.positional_discipline_score > 1.5
              ? p.positional_discipline_score
              : p.positional_discipline_score * 100;
            return {
              name: p.display_name,
              value: [
                Number(p.vaep_per90 ?? 0),
                Number(p.xt_per90 ?? 0),
                Number(p.team_xt_share_pct ?? 0),
                Number(p.padj_defensive_actions_per90 ?? 0),
                Number(p.hir_distance_m_per90 ?? 0),
                Number(disc.toFixed(1)),
              ],
              lineStyle: { color: c, width: 2 },
              itemStyle: { color: c },
              areaStyle: { color: c, opacity: 0.16 },
            };
          }),
        },
      ],
    };

    chart.setOption(option, true);
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [players, lang]);

  useEffect(() => {
    return () => {
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  return <div ref={hostRef} className="w-full h-[290px]" dir="ltr" />;
}

export function EChartsVaepScatter({
  players,
  selectedIds,
  lang,
  onSelectPlayer,
}: {
  players: ScoutingPlayer[];
  selectedIds: string[];
  lang: "ar" | "en";
  onSelectPlayer?: (playerId: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    if (!chartRef.current) {
      chartRef.current = echarts.init(el, undefined, { renderer: "canvas" });
    }
    const chart = chartRef.current;
    const isAr = lang === "ar";
    const selSet = new Set(selectedIds);

    const dataPts = players
      .filter((p) => p.vaep_per90 !== null && p.xt_per90 !== null)
      .map((p) => ({
        name: p.display_name,
        playerId: p.player_id,
        position: p.position,
        rating: p.rating_10 ?? 0,
        trans: p.league_translation_pct ?? 70,
        value: [Number(p.xt_per90 ?? 0), Number(p.vaep_per90 ?? 0), Number(p.league_translation_pct ?? 70)],
        itemStyle: {
          color: selSet.has(p.player_id) ? "#10B981" : "#38BDF8",
          borderColor: selSet.has(p.player_id) ? "#FFFFFF" : "rgba(255,255,255,0.3)",
          borderWidth: selSet.has(p.player_id) ? 2 : 1,
        },
      }));

    chart.setOption(
      {
        backgroundColor: "transparent",
        grid: { left: 46, right: 28, top: 24, bottom: 36 },
        tooltip: {
          trigger: "item",
          backgroundColor: "rgba(9, 13, 22, 0.94)",
          borderColor: "rgba(255,255,255,0.14)",
          textStyle: { color: "#F8FAFC", fontSize: 11 },
          formatter: (params: unknown) => {
            const d = (params as { data?: (typeof dataPts)[number] }).data;
            if (!d) return "";
            return `<b>${d.name}</b> (${d.position})<br/>xT/90: ${d.value[0].toFixed(2)} • VAEP/90: ${d.value[1].toFixed(2)}<br/>Rating: ${d.rating}/10 • Pace Fit: ${d.trans}%`;
          },
        },
        xAxis: {
          name: "xT / 90",
          nameLocation: "middle",
          nameGap: 22,
          nameTextStyle: { color: "#94A3B8", fontSize: 10 },
          axisLabel: { color: "#94A3B8", fontSize: 10 },
          splitLine: { lineStyle: { color: "rgba(255,255,255,0.06)" } },
        },
        yAxis: {
          name: "VAEP / 90",
          nameTextStyle: { color: "#94A3B8", fontSize: 10 },
          axisLabel: { color: "#94A3B8", fontSize: 10 },
          splitLine: { lineStyle: { color: "rgba(255,255,255,0.06)" } },
        },
        series: [
          {
            type: "scatter",
            symbolSize: (val: number[]) => Math.max(10, Math.min(22, (val[2] - 40) * 0.40)),
            labelLayout: { hideOverlap: true },
            label: {
              show: true,
              position: "top",
              color: "#CBD5E1",
              fontSize: 9,
              formatter: (p: unknown) => {
                const d = (p as { data?: (typeof dataPts)[number] }).data;
                return d ? d.name.split(" ").slice(-1)[0] : "";
              },
            },
            data: dataPts,
          },
        ],
      },
      true
    );

    chart.off("click");
    chart.on("click", (params: unknown) => {
      const d = (params as { data?: { playerId?: string } }).data;
      if (d?.playerId && onSelectPlayer) onSelectPlayer(d.playerId);
    });

    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [players, selectedIds, lang, onSelectPlayer]);

  useEffect(() => {
    return () => {
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  return <div ref={hostRef} className="w-full h-[230px]" dir="ltr" />;
}

export function EChartsMatchMomentum({
  frames,
  currentTimeS,
  teamAName,
  teamBName,
  teamAHex,
  teamBHex,
  onSeek,
}: {
  frames: TimelineFrame[];
  currentTimeS: number;
  teamAName: string;
  teamBName: string;
  teamAHex: string;
  teamBHex: string;
  onSeek: (timeS: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const sampledRef = useRef<TimelineFrame[]>([]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || !frames.length) return;
    if (!chartRef.current) {
      chartRef.current = echarts.init(el, undefined, { renderer: "canvas" });
    }
    const chart = chartRef.current;
    const step = frames.length > 90 ? 2 : 1;
    const sampled = frames.filter((_, idx) => idx % step === 0);
    sampledRef.current = sampled;

    const times = sampled.map((f) => `${f.time_s.toFixed(1)}s`);
    const posVals = sampled.map((f) => {
      const m = f.momentum ?? 0;
      return m >= 0 ? m : 0;
    });
    const negVals = sampled.map((f) => {
      const m = f.momentum ?? 0;
      return m < 0 ? m : 0;
    });

    let activeIdx = 0;
    let bestDiff = 9999;
    sampled.forEach((f, idx) => {
      const d = Math.abs(f.time_s - currentTimeS);
      if (d < bestDiff) {
        bestDiff = d;
        activeIdx = idx;
      }
    });

    chart.setOption(
      {
        backgroundColor: "transparent",
        animation: false,
        grid: { left: 8, right: 8, top: 14, bottom: 20 },
        tooltip: {
          trigger: "axis",
          backgroundColor: "rgba(9, 13, 22, 0.94)",
          borderColor: "rgba(255,255,255,0.14)",
          textStyle: { color: "#F8FAFC", fontSize: 11 },
          formatter: (params: unknown) => {
            const arr = params as Array<{ dataIndex?: number; axisValue?: string }>;
            const idx = arr?.[0]?.dataIndex ?? 0;
            const fr = sampledRef.current[idx];
            if (!fr) return "";
            const m = fr.momentum ?? 0;
            const owner = m >= 0 ? teamAName : teamBName;
            return `<b>${fr.time_s.toFixed(1)}s</b> • ${owner}<br/>Momentum: <b>${m > 0 ? "+" : ""}${m}</b>`;
          },
        },
        xAxis: {
          type: "category",
          data: times,
          axisLine: { lineStyle: { color: "rgba(255,255,255,0.12)" } },
          axisLabel: { color: "#64748B", fontSize: 9, interval: Math.max(1, Math.floor(times.length / 6)) },
          axisTick: { show: false },
        },
        yAxis: {
          type: "value",
          min: -100,
          max: 100,
          show: false,
        },
        series: [
          {
            name: teamAName,
            type: "bar",
            stack: "mom",
            barWidth: "78%",
            itemStyle: { color: teamAHex, borderRadius: [2, 2, 0, 0], opacity: 0.82 },
            data: posVals,
            markLine: {
              symbol: "none",
              silent: true,
              label: { show: false },
              lineStyle: { color: "#10B981", width: 2, type: "solid" },
              data: [{ xAxis: activeIdx }],
            },
          },
          {
            name: teamBName,
            type: "bar",
            stack: "mom",
            barWidth: "78%",
            itemStyle: { color: teamBHex, borderRadius: [0, 0, 2, 2], opacity: 0.82 },
            data: negVals,
          },
        ],
      },
      true
    );

    chart.off("click");
    chart.on("click", (params: unknown) => {
      const idx = (params as { dataIndex?: number }).dataIndex;
      if (idx !== undefined && sampledRef.current[idx]) {
        onSeek(sampledRef.current[idx].time_s);
      }
    });

    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [frames, currentTimeS, teamAName, teamBName, teamAHex, teamBHex, onSeek]);

  useEffect(() => {
    return () => {
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  return <div ref={hostRef} className="w-full h-[96px] cursor-pointer" dir="ltr" />;
}
