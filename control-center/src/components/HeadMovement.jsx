import { useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
} from "recharts";

const HeadMovementTooltip = ({ active, payload, label }) => {
  if (!active || !payload || payload.length === 0) return null;

  const row = payload[0].payload;

  return (
    <div className="bg-white border border-[#ececea] p-4 rounded-2xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.15)] min-w-[220px]">
      <div className="mb-3 border-b border-[#ececea] pb-3">
        <p className="text-[10px] text-[#8a8a85] uppercase tracking-widest font-bold mb-1">
          Time: {Number(label).toFixed(2)}s
        </p>
        <p className="text-sm font-black text-[#111111]">
          {row.activePhaseLabel || 'Recording'}
        </p>
      </div>

      <div className="flex flex-col gap-2 text-xs">
        <div className="flex items-center justify-between gap-4">
          <span className="font-bold text-[#111111]">Movement Index</span>
          <span className="font-mono font-bold text-[#6b6b66]">
            {Number(row.movementIndex).toFixed(2)}
          </span>
        </div>

        <div className="flex items-center justify-between gap-4">
          <span className="text-[#6b6b66]">Acceleration change</span>
          <span className="font-mono text-[#6b6b66]">
            {Number(row.accelerationChange).toFixed(3)}
          </span>
        </div>

        <div className="flex items-center justify-between gap-4">
          <span className="text-[#6b6b66]">Rotation speed</span>
          <span className="font-mono text-[#6b6b66]">
            {Number(row.rotationSpeed).toFixed(1)}°/s
          </span>
        </div>

        {row.isHighMovement && (
          <div className="mt-1 rounded-lg bg-red-50 border border-red-200 px-2.5 py-2 text-red-700 font-bold uppercase tracking-wider text-[10px]">
            High movement · potential motion contamination
          </div>
        )}
      </div>
    </div>
  );
};

export default function HeadMovement({ motionData, markerChanges }) {
  const {
    processedMotion,
    highMovementZones,
    totalAlerts,
    threshold,
    sampleRate,
    totalHighDuration,
  } = useMemo(() => {
    if (!motionData || motionData.length < 3) {
      return {
        processedMotion: [],
        highMovementZones: [],
        totalAlerts: 0,
        threshold: 0,
        sampleRate: 0,
        totalHighDuration: 0,
      };
    }

    const ordered = [...motionData]
      .filter(row => Number.isFinite(Number(row.timeRelativo)))
      .sort((a, b) => Number(a.timeRelativo) - Number(b.timeRelativo));

    if (ordered.length < 3) {
      return {
        processedMotion: [],
        highMovementZones: [],
        totalAlerts: 0,
        threshold: 0,
        sampleRate: 0,
        totalHighDuration: 0,
      };
    }

    const median = (values) => {
      const valid = values
        .filter(Number.isFinite)
        .sort((a, b) => a - b);

      if (valid.length === 0) return 0;

      const middle = Math.floor(valid.length / 2);
      return valid.length % 2 === 0
        ? (valid[middle - 1] + valid[middle]) / 2
        : valid[middle];
    };

    const robustStats = (values) => {
      const center = median(values);
      const mad = median(values.map(value => Math.abs(value - center)));
      return {
        median: center,
        scale: Math.max(1e-6, 1.4826 * mad),
      };
    };

    const intervals = [];
    for (let i = 1; i < ordered.length; i++) {
      const dt =
        Number(ordered[i].timeRelativo) -
        Number(ordered[i - 1].timeRelativo);

      if (Number.isFinite(dt) && dt > 0 && dt < 1) {
        intervals.push(dt);
      }
    }

    const medianDt = median(intervals);
    const estimatedRate =
      medianDt > 0 ? Math.max(1, Math.min(256, 1 / medianDt)) : 32;

    // Circa 300 ms di smoothing per attenuare rumore campione-per-campione
    // senza cancellare movimenti reali della testa.
    let smoothingWindow = Math.max(3, Math.round(estimatedRate * 0.30));
    if (smoothingWindow % 2 === 0) smoothingWindow += 1;
    const halfWindow = Math.floor(smoothingWindow / 2);

    const smoothValue = (index, key) => {
      let sum = 0;
      let count = 0;

      const start = Math.max(0, index - halfWindow);
      const end = Math.min(ordered.length - 1, index + halfWindow);

      for (let i = start; i <= end; i++) {
        const value = Number(ordered[i][key]);
        if (Number.isFinite(value)) {
          sum += value;
          count++;
        }
      }

      return count > 0 ? sum / count : null;
    };

    const smoothed = ordered.map((row, index) => {
      const q = [
        smoothValue(index, 'q0'),
        smoothValue(index, 'q1'),
        smoothValue(index, 'q2'),
        smoothValue(index, 'q3'),
      ];

      const qNorm = Math.sqrt(
        q.reduce(
          (sum, value) =>
            sum + (Number.isFinite(value) ? value * value : 0),
          0
        )
      );

      const normalizedQ =
        qNorm > 0
          ? q.map(value =>
              Number.isFinite(value) ? value / qNorm : 0
            )
          : [1, 0, 0, 0];

      return {
        ...row,
        accXSmoothed: smoothValue(index, 'accX'),
        accYSmoothed: smoothValue(index, 'accY'),
        accZSmoothed: smoothValue(index, 'accZ'),
        qSmoothed: normalizedQ,
      };
    });

    const accelerationChanges = new Array(smoothed.length).fill(0);
    const rotationSpeeds = new Array(smoothed.length).fill(0);

    for (let i = 1; i < smoothed.length; i++) {
      const dt = Math.max(
        0.001,
        Number(smoothed[i].timeRelativo) -
          Number(smoothed[i - 1].timeRelativo)
      );

      const ax1 = Number(smoothed[i - 1].accXSmoothed);
      const ay1 = Number(smoothed[i - 1].accYSmoothed);
      const az1 = Number(smoothed[i - 1].accZSmoothed);

      const ax2 = Number(smoothed[i].accXSmoothed);
      const ay2 = Number(smoothed[i].accYSmoothed);
      const az2 = Number(smoothed[i].accZSmoothed);

      if (
        [ax1, ay1, az1, ax2, ay2, az2].every(Number.isFinite)
      ) {
        const deltaAcceleration = Math.sqrt(
          Math.pow(ax2 - ax1, 2) +
          Math.pow(ay2 - ay1, 2) +
          Math.pow(az2 - az1, 2)
        );

        // Variazione per secondo: rimuove il contributo statico della gravità
        // e rende l'indice sensibile al cambiamento reale dell'accelerazione.
        accelerationChanges[i] = deltaAcceleration / dt;
      }

      const q1 = smoothed[i - 1].qSmoothed;
      const q2 = smoothed[i].qSmoothed;

      let dot =
        q1[0] * q2[0] +
        q1[1] * q2[1] +
        q1[2] * q2[2] +
        q1[3] * q2[3];

      // q e -q rappresentano la stessa orientazione.
      dot = Math.abs(dot);
      dot = Math.max(-1, Math.min(1, dot));

      const angleDegrees =
        2 * Math.acos(dot) * (180 / Math.PI);

      rotationSpeeds[i] = angleDegrees / dt;
    }

    const accStats = robustStats(accelerationChanges.slice(1));
    const rotStats = robustStats(rotationSpeeds.slice(1));

    const rawMovementIndex = smoothed.map((row, index) => {
      const accZ = Math.max(
        0,
        (accelerationChanges[index] - accStats.median) /
          accStats.scale
      );

      const rotZ = Math.max(
        0,
        (rotationSpeeds[index] - rotStats.median) /
          rotStats.scale
      );

      // Indice relativo e adimensionale: combina variazione accelerometrica
      // e variazione di orientamento senza confondere la gravità con movimento.
      return Math.sqrt(accZ * accZ + rotZ * rotZ);
    });

    // Ulteriore smoothing di circa 500 ms sull'indice finale.
    let indexWindow = Math.max(3, Math.round(estimatedRate * 0.50));
    if (indexWindow % 2 === 0) indexWindow += 1;
    const indexHalf = Math.floor(indexWindow / 2);

    const movementIndex = rawMovementIndex.map((_, index) => {
      let sum = 0;
      let count = 0;

      const start = Math.max(0, index - indexHalf);
      const end = Math.min(rawMovementIndex.length - 1, index + indexHalf);

      for (let i = start; i <= end; i++) {
        const value = rawMovementIndex[i];
        if (Number.isFinite(value)) {
          sum += value;
          count++;
        }
      }

      return count > 0 ? sum / count : 0;
    });

    const movementStats = robustStats(movementIndex);

    // Soglia completamente robusta e adattiva alla singola sessione.
    // È ricavata dalla distribuzione del Movement Index:
    // mediana + 2.5 * MAD robustamente scalata.
    // Non significa "artefatto certo": individua finestre con movimento
    // nettamente superiore al livello tipico della sessione.
    const adaptiveThreshold =
      movementStats.median + 2.5 * movementStats.scale;

    const preliminaryZones = [];
    let zoneStart = null;

    for (let i = 0; i < smoothed.length; i++) {
      const isHigh = movementIndex[i] > adaptiveThreshold;

      if (isHigh && zoneStart === null) {
        zoneStart = i;
      }

      const isLast = i === smoothed.length - 1;

      if ((!isHigh || isLast) && zoneStart !== null) {
        const zoneEnd =
          isHigh && isLast ? i : Math.max(zoneStart, i - 1);

        preliminaryZones.push({
          startIndex: zoneStart,
          endIndex: zoneEnd,
          start: Number(smoothed[zoneStart].timeRelativo),
          end: Number(smoothed[zoneEnd].timeRelativo),
        });

        zoneStart = null;
      }
    }

    // Unisce micro-interruzioni inferiori a 250 ms.
    const mergedZones = [];

    preliminaryZones.forEach(zone => {
      const previous = mergedZones[mergedZones.length - 1];

      if (
        previous &&
        zone.start - previous.end <= 0.25
      ) {
        previous.end = zone.end;
        previous.endIndex = zone.endIndex;
      } else {
        mergedZones.push({ ...zone });
      }
    });

    // Ignora singoli spike brevissimi: una finestra deve durare almeno 250 ms.
    const validZones = mergedZones
      .filter(zone => zone.end - zone.start >= 0.25)
      .map(zone => {
        let peak = 0;

        for (let i = zone.startIndex; i <= zone.endIndex; i++) {
          peak = Math.max(peak, movementIndex[i] || 0);
        }

        return {
          ...zone,
          peak,
        };
      });

    const processed = smoothed.map((row, index) => {
      const time = Number(row.timeRelativo);

      const isHighMovement = validZones.some(
        zone => time >= zone.start && time <= zone.end
      );

      return {
        timeRelativo: time,
        activeSlide: row.activeSlide,
        activePhaseLabel: row.activePhaseLabel,
        movementIndex: movementIndex[index],
        accelerationChange: accelerationChanges[index],
        rotationSpeed: rotationSpeeds[index],
        isHighMovement,
      };
    });

    const highDuration = validZones.reduce(
      (sum, zone) => sum + Math.max(0, zone.end - zone.start),
      0
    );

    return {
      processedMotion: processed,
      highMovementZones: validZones,
      totalAlerts: validZones.length,
      threshold: adaptiveThreshold,
      sampleRate: estimatedRate,
      totalHighDuration: highDuration,
    };
  }, [motionData]);

  if (!processedMotion || processedMotion.length === 0) return null;

  const markerLabel = (change, index) => {
    if (change.phaseType === 'boundary') return 'END';
    if (change.phaseType === 'start') return 'START';
    if (change.phaseType === 'finish') return 'FINISH';

    const match = String(change.slide || '').match(/slide\s*(\d+)/i);
    if (match) return `S${match[1]}`;

    return `M${index + 1}`;
  };

  const maxTime = Math.max(
    processedMotion[processedMotion.length - 1]?.timeRelativo || 0,
    ...(markerChanges || []).map(marker => Number(marker.time) || 0)
  );

  return (
    <div className="bg-[#fafaf8] border border-[#ececea] rounded-2xl p-6 w-full">
      <div className="flex flex-col md:flex-row md:items-start justify-between mb-6 gap-4">
        <div>
          <h3 className="text-sm font-bold tracking-widest text-[#8a8a85] uppercase">
            Head Movement
          </h3>

          <p className="text-xs text-[#6b6b66] mt-1">
            Relative movement timeline for signal-quality interpretation
          </p>

          <p className="text-[10px] text-[#8a8a85] mt-2 uppercase tracking-wider font-bold">
            {processedMotion.length} Motion samples · ~{sampleRate.toFixed(1)} Hz · robust adaptive threshold {threshold.toFixed(2)}
          </p>
        </div>

        {totalAlerts > 0 ? (
          <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider flex items-center gap-2 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
            {totalAlerts} High Movement {totalAlerts === 1 ? 'Window' : 'Windows'} · {totalHighDuration.toFixed(1)}s
          </div>
        ) : (
          <div className="bg-green-50 border border-green-200 text-green-700 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500"></span>
            No sustained high movement
          </div>
        )}
      </div>

      <div className="w-full h-[270px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={processedMotion}
            margin={{ top: 48, right: 25, bottom: 5, left: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#e5e5e0"
              vertical={false}
            />

            <XAxis
              dataKey="timeRelativo"
              type="number"
              domain={[0, Math.max(1, Math.ceil(maxTime))]}
              stroke="#a3a39c"
              fontSize={12}
              tickMargin={10}
              unit="s"
            />

            <YAxis
              stroke="#a3a39c"
              fontSize={12}
              domain={[0, 'auto']}
              width={35}
            />

            <Tooltip
              content={<HeadMovementTooltip />}
              cursor={{ stroke: '#ececea', strokeWidth: 2 }}
            />

            {(markerChanges || []).map((change, index) => (
              <ReferenceLine
                key={`motion-marker-${change.time}-${index}`}
                x={change.time}
                stroke="#111111"
                strokeDasharray="4 4"
                strokeOpacity={0.35}
                isFront={true}
                ifOverflow="extendDomain"
                label={{
                  position: 'insideTop',
                  value: markerLabel(change, index),
                  fill: '#111111',
                  fontSize: 9,
                  fontWeight: 'bold',
                  dy: 4 + (change.labelLane || 0) * 14,
                }}
              />
            ))}

            {highMovementZones.map((zone, index) => (
              <ReferenceArea
                key={`high-movement-${index}`}
                x1={zone.start}
                x2={zone.end}
                fill="#fecaca"
                fillOpacity={0.55}
                ifOverflow="extendDomain"
              />
            ))}

            <ReferenceLine
              y={threshold}
              stroke="#dc2626"
              strokeDasharray="6 4"
              strokeOpacity={0.75}
              label={{
                value: 'High movement',
                position: 'insideTopRight',
                fill: '#b91c1c',
                fontSize: 9,
                fontWeight: 'bold',
              }}
            />

            <Area
              type="monotone"
              dataKey="movementIndex"
              name="Movement Index"
              stroke="#52525b"
              fill="#d4d4d8"
              fillOpacity={0.65}
              strokeWidth={1.7}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 pt-4 border-t border-[#ececea] grid grid-cols-1 md:grid-cols-3 gap-3 text-[10px] text-[#6b6b66] leading-relaxed">
        <p>
          <span className="font-bold text-[#111111]">Movement Index:</span>{' '}
          combines smoothed accelerometer variation and head-orientation change.
        </p>

        <p>
          <span className="font-bold text-[#111111]">Red windows:</span>{' '}
          sustained movement above the robust session-adaptive threshold.
        </p>

        <p>
          <span className="font-bold text-[#111111]">Interpretation:</span>{' '}
          high movement indicates possible motion contamination, not a confirmed EEG artifact.
        </p>
      </div>
    </div>
  );
}
