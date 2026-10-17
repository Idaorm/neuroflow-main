import { useEffect, useMemo, useState } from "react";
import { EPOC_X_ELECTRODES, BANDS } from "../constants/eegConstants";
import { getScalpPhases, getPhaseName } from "../utils/scalpMapUtils";

export default function BandPowerMatrix({ bandPowerData, totalSlides }) {
  const [selectedSlide, setSelectedSlide] = useState(1);
  const slidesArray = getScalpPhases(totalSlides);
  const phaseName = getPhaseName;
  useEffect(() => {
    if (selectedSlide > totalSlides) setSelectedSlide(1);
  }, [selectedSlide, totalSlides]);

  const bandLabel = (band) => {
    if (band === 'BetaL') return 'Beta Low';
    if (band === 'BetaH') return 'Beta High';
    return band;
  };

  // Calcola la matrice 14 x 5 di una singola fase.
  // Ogni cella = media della banda sull'elettrodo durante quella fase.
  const calculatePhaseMatrix = (phase) => {
    if (!bandPowerData || bandPowerData.length === 0) return null;

    const phaseRows = bandPowerData.filter(row => row.activeSlide === phase);
    if (phaseRows.length === 0) return null;

    const matrix = {};
    const values = [];

    EPOC_X_ELECTRODES.forEach(el => {
      matrix[el.id] = {};

      BANDS.forEach(band => {
        const expectedKey = `${el.id}.${band}`.toLowerCase();
        const colKey = Object.keys(phaseRows[0]).find(
          key => key.toLowerCase() === expectedKey
        );

        if (!colKey) {
          matrix[el.id][band] = null;
          return;
        }

        const samples = phaseRows
          .filter(row => row[colKey] !== null && row[colKey] !== undefined && row[colKey] !== "")
          .map(row => Number(row[colKey]))
          .filter(value => Number.isFinite(value));

        const avg =
          samples.length > 0
            ? samples.reduce((sum, value) => sum + value, 0) / samples.length
            : null;

        matrix[el.id][band] = avg;

        if (Number.isFinite(avg)) {
          values.push(avg);
        }
      });
    });

    return {
      matrix,
      values,
      sampleCount: phaseRows.length,
    };
  };

  const matrixData = useMemo(() => {
    const phaseMatrix = calculatePhaseMatrix(selectedSlide);
    if (!phaseMatrix) return null;

    return {
      ...phaseMatrix,
      phase: selectedSlide,
    };
  }, [bandPowerData, selectedSlide]);

  // SCALA CROMATICA FISSA:
  // viene calcolata una sola volta sui VALORI MEDI delle celle di tutte
  // le fasi disponibili. In questo modo lo stesso valore numerico mantiene
  // lo stesso colore passando da una slide all'altra.
  const globalColorScale = useMemo(() => {
    if (!bandPowerData || bandPowerData.length === 0) {
      return { min: 0, max: 1 };
    }

    const allPhaseAverages = [];

    slidesArray.forEach(phase => {
      const phaseMatrix = calculatePhaseMatrix(phase);
      if (!phaseMatrix) return;

      phaseMatrix.values.forEach(value => {
        if (Number.isFinite(value)) {
          allPhaseAverages.push(value);
        }
      });
    });

    if (allPhaseAverages.length === 0) {
      return { min: 0, max: 1 };
    }

    const min = Math.min(...allPhaseAverages);
    const max = Math.max(...allPhaseAverages);

    if (min === max) {
      return {
        min: min - 0.5,
        max: max + 0.5,
      };
    }

    return { min, max };
  }, [bandPowerData, totalSlides]);

  if (!matrixData) return null;

  const getCellStyles = (val) => {
    if (!Number.isFinite(val)) {
      return {
        backgroundColor: 'rgba(229, 229, 224, 0.55)',
        color: '#8a8a85',
      };
    }

    const { min, max } = globalColorScale;
    const normalized = Math.max(
      0,
      Math.min(1, (val - min) / (max - min))
    );

    // Stessa scala visiva per tutte le slide:
    // valori bassi quasi bianchi, valori alti arancione intenso.
    const opacity = 0.08 + normalized * 0.92;
    const textColor = normalized > 0.62 ? '#ffffff' : '#111111';

    return {
      backgroundColor: `rgba(234, 88, 12, ${opacity})`,
      color: textColor,
    };
  };

  return (
    <div className="bg-white rounded-[28px] p-7 border border-[#ececea] shadow-sm flex flex-col w-full">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4 border-b border-[#ececea] pb-6">
        <div>
          <h3 className="text-xl font-bold text-[#111111]">BandPower Matrix</h3>

          <p className="text-sm text-[#6b6b66]">
            Electrode / Frequency cross-analysis ({phaseName(selectedSlide)})
          </p>

          <p className="text-[10px] text-[#8a8a85] mt-1 uppercase tracking-wider font-bold">
            {matrixData.sampleCount} BandPower samples · 14 electrodes × 5 bands
          </p>
        </div>

        <select
          className="px-4 py-2 border border-[#ececea] rounded-full text-xs font-bold bg-[#fafaf8] uppercase cursor-pointer outline-none"
          value={selectedSlide}
          onChange={(e) => setSelectedSlide(Number(e.target.value))}
        >
          {slidesArray.map(s => (
            <option key={s} value={s}>
              {phaseName(s)}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr>
              <th className="p-3 text-[10px] font-bold tracking-widest text-[#8a8a85] uppercase border-b border-[#ececea]">
                Channel
              </th>

              {BANDS.map(band => (
                <th
                  key={band}
                  className="p-3 text-[10px] font-bold tracking-widest text-[#8a8a85] uppercase border-b border-[#ececea] text-center"
                >
                  {bandLabel(band)}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {EPOC_X_ELECTRODES.map(el => (
              <tr
                key={el.id}
                className="border-b border-[#ececea] hover:bg-[#fafaf8] transition-colors"
              >
                <td className="p-3 text-xs font-black text-[#111111]">
                  {el.id}
                </td>

                {BANDS.map(band => {
                  const val = matrixData.matrix[el.id][band];

                  return (
                    <td key={band} className="p-1">
                      <div
                        className="w-full h-full p-2.5 rounded-lg text-center text-xs font-mono font-bold transition-all"
                        style={getCellStyles(val)}
                        title={
                          Number.isFinite(val)
                            ? `${el.id} · ${bandLabel(band)}: ${val.toFixed(4)}`
                            : `${el.id} · ${bandLabel(band)}: N/A`
                        }
                      >
                        {Number.isFinite(val) ? val.toFixed(2) : 'N/A'}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 pt-5 border-t border-[#ececea]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-bold text-[#8a8a85] uppercase tracking-wider">
            Global color scale
          </span>
          <span className="text-[10px] font-medium text-[#8a8a85]">
            fixed across monitored slides
          </span>
        </div>

        <div
          className="w-full h-3 rounded-full border border-[#ececea]"
          style={{
            background:
              'linear-gradient(to right, rgba(234, 88, 12, 0.08), rgba(234, 88, 12, 1))',
          }}
        />

        <div className="w-full flex justify-between mt-1 text-[10px] font-mono font-bold text-[#6b6b66]">
          <span>{globalColorScale.min.toFixed(3)}</span>
          <span>{globalColorScale.max.toFixed(3)}</span>
        </div>

        <p className="text-[10px] text-[#8a8a85] mt-3 leading-relaxed">
          Each cell is the mean BandPower value for one electrode and one frequency band
          during the selected phase. The color scale is kept constant across phases,
          so equal values always have equal color intensity.
        </p>
      </div>
    </div>
  );
}
