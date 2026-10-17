import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { EPOC_X_ELECTRODES } from "../constants/eegConstants";
import { getScalpRgb } from "../utils/scalpMapUtils";

const MODEL_URL = "/models/scalp.glb";
const TARGET_HEAD_HEIGHT = 2.55;
const NEUTRAL_SURFACE = [234, 232, 227];

const EXCLUDED_MESH_NAMES =
  /eye|eyeball|sclera|iris|teeth|tooth|tongue|gum|mouth|lash|brow|cornea/i;

/*
 * Coordinate 3D calibrate direttamente sulla mesh principale del file
 * scalp.glb fornito.
 *
 * IMPORTANTE:
 * la mesh principale è già anatomicamente coerente nel suo sistema locale:
 *   local X = sinistra/destra
 *   local Y = basso/alto
 *   local Z = retro/fronte
 *
 * Nel modello locale +X corrisponde al lato anatomico sinistro.
 * Le posizioni sotto sono punti reali della superficie del capo, non punti
 * generati su una sfera matematica.
 */
const CALIBRATED_ELECTRODES = {
  AF3: [ 0.04909715, 0.37545985,  0.11473099],
  AF4: [-0.04909715, 0.37545982,  0.11473099],
  F7:  [ 0.08480917, 0.34720233,  0.05834587],
  F3:  [ 0.04769479, 0.40357560,  0.06917761],
  F4:  [-0.04769484, 0.40357575,  0.06917762],
  F8:  [-0.08480919, 0.34720230,  0.05834587],
  FC5: [ 0.06836248, 0.39272159,  0.02311540],
  FC6: [-0.06836332, 0.39272058,  0.02311496],
  T7:  [ 0.08587275, 0.33308843,  0.01560794],
  T8:  [-0.08587277, 0.33308846,  0.01560786],
  P7:  [ 0.06184135, 0.32299665, -0.03424535],
  P8:  [-0.06184218, 0.32299572, -0.03424411],
  O1:  [ 0.02090803, 0.33676216, -0.05884299],
  O2:  [-0.02090794, 0.33676487, -0.05884355],
};

/*
 * Centro approssimativo della calotta cranica nello stesso sistema locale.
 * Serve solo per le direzioni IDW e per spostare di pochi millimetri i marker
 * al di sopra della superficie.
 */
const CALIBRATED_SCALP_ORIGIN = new THREE.Vector3(0, 0.29, 0.01);

const clamp01 = (value) => Math.max(0, Math.min(1, value));

const smoothstep = (edge0, edge1, value) => {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;

  const t = clamp01(
    (value - edge0) / (edge1 - edge0)
  );

  return t * t * (3 - 2 * t);
};

const mixRgb = (a, b, t) => {
  const factor = clamp01(t);

  return [
    a[0] + (b[0] - a[0]) * factor,
    a[1] + (b[1] - a[1]) * factor,
    a[2] + (b[2] - a[2]) * factor,
  ];
};

const disposeMaterial = (material) => {
  if (!material) return;

  const materials = Array.isArray(material)
    ? material
    : [material];

  materials.forEach((item) => {
    if (!item) return;

    Object.values(item).forEach((value) => {
      if (value?.isTexture) {
        value.dispose();
      }
    });

    item.dispose?.();
  });
};

const disposeObject = (object) => {
  object?.traverse?.((child) => {
    child.geometry?.dispose?.();
    disposeMaterial(child.material);
  });
};

const clearGroup = (group) => {
  if (!group) return;

  while (group.children.length > 0) {
    const child = group.children.pop();
    disposeObject(child);
  }
};

const interpolateValue = (
  direction,
  validSensors
) => {
  if (validSensors.length === 0) {
    return null;
  }

  let numerator = 0;
  let denominator = 0;

  const epsilon = 0.035;
  const power = 2.2;

  for (const sensor of validSensors) {
    const dot = THREE.MathUtils.clamp(
      direction.dot(sensor.direction),
      -1,
      1
    );

    const angularDistance = Math.acos(dot);

    if (angularDistance < 0.012) {
      return sensor.value;
    }

    const weight =
      1 /
      Math.pow(
        angularDistance + epsilon,
        power
      );

    numerator +=
      weight * sensor.value;

    denominator += weight;
  }

  return denominator > 0
    ? numerator / denominator
    : null;
};

export default function ScalpMap3D({
  electrodeValues = {},
  selectedBand = "Alpha",
  compareMode = false,
  absoluteScale = { min: 0, max: 1 },
  deltaScale = { maxAbs: 1 },
}) {
  const mountRef = useRef(null);
  const resetViewRef = useRef(null);
  const controlsRef = useRef(null);
  const cameraRef = useRef(null);
  const viewPresetsRef = useRef({});
  const autoRotateEnabledRef = useRef(false);

  const modelRootRef = useRef(null);
  const mainHeadMeshRef = useRef(null);
  const electrodeGroupRef = useRef(null);
  const electrodeMeshesRef = useRef([]);

  const modelScaleRef = useRef(1);
  const scalpOriginRef =
    useRef(new THREE.Vector3());

  const modelBoundsRef = useRef(null);

  const [modelReady, setModelReady] =
    useState(false);

  const [modelError, setModelError] =
    useState("");

  const [
    selectedElectrode,
    setSelectedElectrode,
  ] = useState(null);

  const [
    isAutoRotating,
    setIsAutoRotating,
  ] = useState(false);

  const [
    hoveredElectrode,
    setHoveredElectrode,
  ] = useState(null);

  const sensors = useMemo(
    () =>
      EPOC_X_ELECTRODES.map(
        (electrode) => {
          const calibrated =
            CALIBRATED_ELECTRODES[
              electrode.id
            ];

          return {
            ...electrode,

            calibratedPosition:
              calibrated
                ? new THREE.Vector3(
                    ...calibrated
                  )
                : null,

            value:
              electrodeValues?.[
                electrode.id
              ] ?? null,
          };
        }
      ),
    [electrodeValues]
  );

  // ================================================================
  // 1. CARICAMENTO DEL MODELLO E ALLINEAMENTO
  // ================================================================
  useEffect(() => {
    const mount = mountRef.current;

    if (!mount) {
      return undefined;
    }

    let disposed = false;
    let animationFrame = null;

    setModelReady(false);
    setModelError("");

    const scene = new THREE.Scene();

    scene.background =
      new THREE.Color(0xfafaf8);

    const camera =
      new THREE.PerspectiveCamera(
        32,
        1,
        0.01,
        100
      );

    cameraRef.current = camera;

    const renderer =
      new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference:
          "high-performance",
      });

    renderer.outputColorSpace =
      THREE.SRGBColorSpace;

    renderer.toneMapping =
      THREE.ACESFilmicToneMapping;

    renderer.toneMappingExposure = 1.04;

    renderer.setPixelRatio(
      Math.min(
        window.devicePixelRatio || 1,
        2
      )
    );

    renderer.domElement.style.width =
      "100%";

    renderer.domElement.style.height =
      "100%";

    renderer.domElement.style.display =
      "block";

    renderer.domElement.style.cursor =
      "grab";

    renderer.domElement.setAttribute(
      "aria-label",
      "Interactive 3D EEG scalp map"
    );

    mount.appendChild(
      renderer.domElement
    );

    const controls =
      new OrbitControls(
        camera,
        renderer.domElement
      );

    controls.enableDamping = true;
    controls.dampingFactor = 0.10;
    controls.enablePan = false;

    // Interazione più morbida e controllabile con mouse/trackpad.
    controls.rotateSpeed = 0.48;
    controls.zoomSpeed = 0.72;
    controls.enableZoom = true;
    controls.autoRotate = false;

    // Valore negativo = rotazione oraria nella vista frontale iniziale.
    controls.autoRotateSpeed = -1.85;

    if ("zoomToCursor" in controls) {
      controls.zoomToCursor = true;
    }

    controlsRef.current = controls;

    /*
     * Illuminazione morbida: serve soltanto a leggere la forma della testa.
     * I colori EEG restano codificati dai vertex colors.
     */
    const hemisphere =
      new THREE.HemisphereLight(
        0xffffff,
        0xc7c4bd,
        1.45
      );

    scene.add(hemisphere);

    const keyLight =
      new THREE.DirectionalLight(
        0xffffff,
        1.8
      );

    keyLight.position.set(
      2.8,
      4.0,
      4.5
    );

    scene.add(keyLight);

    const fillLight =
      new THREE.DirectionalLight(
        0xffffff,
        0.6
      );

    fillLight.position.set(
      -3.5,
      1.5,
      -2.5
    );

    scene.add(fillLight);

    const electrodeGroup =
      new THREE.Group();

    electrodeGroup.name =
      "EEG_ELECTRODES";

    electrodeGroupRef.current =
      electrodeGroup;

    scene.add(electrodeGroup);

    const loader = new GLTFLoader();

    loader.load(
      MODEL_URL,

      (gltf) => {
        if (disposed) {
          disposeObject(gltf.scene);
          return;
        }

        const root = gltf.scene;

        root.name = "SCALP_GLB";

        root.updateMatrixWorld(true);

        /*
         * Troviamo la mesh anatomica principale.
         * Nel file fornito è GEO-head_sculpting_realistic.
         */
        let mainMesh = null;
        let largestVertexCount = -1;

        root.traverse((child) => {
          if (
            !child.isMesh ||
            !child.geometry
          ) {
            return;
          }

          if (
            EXCLUDED_MESH_NAMES.test(
              child.name || ""
            )
          ) {
            return;
          }

          const count =
            child.geometry.attributes
              .position?.count || 0;

          if (
            count >
            largestVertexCount
          ) {
            largestVertexCount =
              count;

            mainMesh = child;
          }
        });

        if (!mainMesh) {
          setModelError(
            "No anatomical head mesh was found in scalp.glb."
          );

          disposeObject(root);
          return;
        }

        /*
         * FIX FONDAMENTALE
         * ----------------
         * Non proviamo più a indovinare gli assi del file GLB.
         *
         * La geometria locale della mesh principale è già orientata in modo
         * anatomico corretto. Quindi annulliamo ESATTAMENTE la matrixWorld
         * che Blender ha salvato nel GLB.
         *
         * Dopo questa operazione:
         *   X = sinistra/destra
         *   Y = verticale
         *   Z = fronte/retro
         */
        const inverseHeadWorld =
          mainMesh.matrixWorld
            .clone()
            .invert();

        root.applyMatrix4(
          inverseHeadWorld
        );

        root.updateMatrixWorld(true);

        /*
         * A questo punto mainMesh è nel suo vero sistema locale anatomico.
         */
        const canonicalBox =
          new THREE.Box3()
            .setFromObject(
              mainMesh
            );

        const canonicalSize =
          new THREE.Vector3();

        canonicalBox.getSize(
          canonicalSize
        );

        if (
          !Number.isFinite(
            canonicalSize.y
          ) ||
          canonicalSize.y <= 0.0001
        ) {
          setModelError(
            "The anatomical mesh has invalid dimensions."
          );

          disposeObject(root);
          return;
        }

        /*
         * Scala uniforme per avere una dimensione stabile nel viewer.
         */
        const uniformScale =
          TARGET_HEAD_HEIGHT /
          canonicalSize.y;

        modelScaleRef.current =
          uniformScale;

        root.applyMatrix4(
          new THREE.Matrix4()
            .makeScale(
              uniformScale,
              uniformScale,
              uniformScale
            )
        );

        root.updateMatrixWorld(true);

        const scaledBox =
          new THREE.Box3()
            .setFromObject(
              mainMesh
            );

        const scaledSize =
          new THREE.Vector3();

        scaledBox.getSize(
          scaledSize
        );

        modelBoundsRef.current = {
          box: scaledBox.clone(),
          size: scaledSize.clone(),
        };

        const scalpOrigin =
          CALIBRATED_SCALP_ORIGIN
            .clone()
            .multiplyScalar(
              uniformScale
            );

        scalpOriginRef.current.copy(
          scalpOrigin
        );

        /*
         * Manteniamo occhi/iridi neutri.
         * Solo la mesh della testa riceve i vertex colors EEG.
         */
        root.traverse((child) => {
          if (
            !child.isMesh ||
            !child.geometry
          ) {
            return;
          }

          const excluded =
            child !== mainMesh;

          const sourceGeometry =
            child.geometry;

          const smoothGeometry =
            new THREE.BufferGeometry();

          smoothGeometry.setAttribute(
            "position",
            sourceGeometry.attributes
              .position.clone()
          );

          if (sourceGeometry.index) {
            smoothGeometry.setIndex(
              sourceGeometry.index.clone()
            );
          }

          child.geometry =
            mergeVertices(
              smoothGeometry,
              1e-5
            );

          child.geometry
            .computeVertexNormals();

          disposeMaterial(
            child.material
          );

          if (excluded) {
            child.material =
              new THREE.MeshStandardMaterial({
                color:
                  new THREE.Color(
                    0xe8e5df
                  ),

                roughness: 0.92,
                metalness: 0,
                flatShading: false,
                side:
                  THREE.DoubleSide,
              });

            return;
          }

          const position =
            child.geometry.attributes
              .position;

          const colors =
            new Float32Array(
              position.count * 3
            );

          child.geometry.setAttribute(
            "color",
            new THREE.BufferAttribute(
              colors,
              3
            )
          );

          child.material =
            new THREE.MeshStandardMaterial({
              vertexColors: true,
              roughness: 0.88,
              metalness: 0,
              flatShading: false,
              side:
                THREE.DoubleSide,
            });
        });

        scene.add(root);

        root.updateMatrixWorld(true);

        /*
         * Precalcolo per ogni vertice:
         * - direzione dal centro cranico
         * - appartenenza allo SCALPO
         *
         * Usiamo le coordinate locali reali della mesh, non il bounding box
         * ruotato della scena Blender.
         */
        const position =
          mainMesh.geometry.attributes
            .position;

        const directions =
          new Float32Array(
            position.count * 3
          );

        const scalpBlend =
          new Float32Array(
            position.count
          );

        const localVertex =
          new THREE.Vector3();

        const worldVertex =
          new THREE.Vector3();

        const direction =
          new THREE.Vector3();

        for (
          let i = 0;
          i < position.count;
          i++
        ) {
          localVertex
            .fromBufferAttribute(
              position,
              i
            );

          /*
           * Siccome mainMesh ora è orientata anatomicamente, queste coordinate
           * locali sono quelle utili a distinguere scalpo, faccia e collo.
           */
          const localX =
            localVertex.x;

          const localY =
            localVertex.y;

          const localZ =
            localVertex.z;

          worldVertex.copy(
            localVertex
          );

          mainMesh.localToWorld(
            worldVertex
          );

          direction
            .copy(worldVertex)
            .sub(scalpOrigin);

          if (
            direction.lengthSq() >
            1e-10
          ) {
            direction.normalize();
          } else {
            direction.set(
              0,
              1,
              0
            );
          }

          directions[
            i * 3
          ] = direction.x;

          directions[
            i * 3 + 1
          ] = direction.y;

          directions[
            i * 3 + 2
          ] = direction.z;

          /*
           * MASCHERA DELLA CALOTTA
           * ---------------------
           *
           * - dietro e lateralmente basta essere sopra circa y=0.22;
           * - andando verso il viso (+Z) la soglia sale progressivamente;
           * - naso, guance, bocca e collo restano quindi neutri;
           * - fronte e parte superiore del cranio rimangono colorabili.
           */
          const frontalRise =
            1.8 *
            Math.max(
              0,
              localZ - 0.04
            );

          const scalpBoundaryY =
            0.22 + frontalRise;

          const verticalMask =
            smoothstep(
              scalpBoundaryY -
                0.015,
              scalpBoundaryY +
                0.015,
              localY
            );

          /*
           * ESCLUSIONE ORECCHIE
           * ------------------
           * Le orecchie appartengono alla stessa mesh della testa.
           * Le escludiamo usando due indizi contemporaneamente:
           * - posizione molto laterale (|X| elevato);
           * - quota inferiore rispetto alla calotta.
           *
           * La parte temporale superiore resta invece colorabile,
           * quindi T7/T8 non vengono "tagliati" dalla topomap.
           */
          const lateralEarZone =
            smoothstep(
              0.078,
              0.106,
              Math.abs(localX)
            );

          const lowerSideZone =
            1 -
            smoothstep(
              0.295,
              0.345,
              localY
            );

          const earMask =
            1 -
            lateralEarZone *
              lowerSideZone;

          scalpBlend[i] =
            verticalMask *
            earMask;
        }

        mainMesh.userData
          .scalpDirections =
          directions;

        mainMesh.userData
          .scalpBlend =
          scalpBlend;

        mainHeadMeshRef.current =
          mainMesh;

        modelRootRef.current =
          root;

        /*
         * CAMERA
         * ------
         * Fronte = +Z.
         * La camera guarda leggermente dall'alto verso il cranio.
         */
        const maxDimension =
          Math.max(
            scaledSize.x,
            scaledSize.y,
            scaledSize.z
          );

        const target =
          scalpOrigin
            .clone()
            .add(
              new THREE.Vector3(
                0,
                scaledSize.y *
                  0.12,
                0
              )
            );

        // Vista frontale leggermente più ravvicinata:
        // mette la calotta al centro e riduce il peso visivo di collo/spalle.
        const frontCamera =
          new THREE.Vector3(
            0,
            target.y +
              scaledSize.y *
                0.10,
            scaledBox.max.z +
              maxDimension *
                1.32
          );

        const backCamera =
          new THREE.Vector3(
            0,
            target.y +
              scaledSize.y *
                0.10,
            scaledBox.min.z -
              maxDimension *
                1.20
          );

        const topCamera =
          new THREE.Vector3(
            0,
            scaledBox.max.y +
              maxDimension *
                1.18,
            target.z +
              maxDimension *
                0.025
          );

        const defaultUp =
          new THREE.Vector3(
            0,
            1,
            0
          );

        const topUp =
          new THREE.Vector3(
            0,
            0,
            -1
          );

        viewPresetsRef.current = {
          front: {
            position:
              frontCamera.clone(),
            target:
              target.clone(),
            up:
              defaultUp.clone(),
          },
          top: {
            position:
              topCamera.clone(),
            target:
              target.clone(),
            up:
              topUp.clone(),
          },
          back: {
            position:
              backCamera.clone(),
            target:
              target.clone(),
            up:
              defaultUp.clone(),
          },
        };

        camera.up.copy(
          defaultUp
        );

        camera.position.copy(
          frontCamera
        );

        controls.target.copy(
          target
        );

        controls.minDistance =
          maxDimension * 0.66;

        controls.maxDistance =
          maxDimension * 3.2;

        controls.update();

        resetViewRef.current =
          () => {
            camera.up.copy(
              defaultUp
            );

            camera.position.copy(
              frontCamera
            );

            controls.target.copy(
              target
            );

            controls.update();
          };

        setModelReady(true);
      },

      undefined,

      (error) => {
        if (disposed) {
          return;
        }

        console.error(
          "Unable to load scalp.glb:",
          error
        );

        setModelError(
          "Unable to load /models/scalp.glb. Check that the file exists in public/models."
        );
      }
    );

    // --------------------------------------------------------------
    // Click / hover sugli elettrodi
    // --------------------------------------------------------------
    const raycaster =
      new THREE.Raycaster();

    const pointer =
      new THREE.Vector2();

    const updatePointer =
      (event) => {
        const rect =
          renderer.domElement
            .getBoundingClientRect();

        pointer.x =
          ((event.clientX -
            rect.left) /
            Math.max(
              1,
              rect.width
            )) *
            2 -
          1;

        pointer.y =
          -(
            (event.clientY -
              rect.top) /
            Math.max(
              1,
              rect.height
            )
          ) *
            2 +
          1;
      };

    const handlePointerDown =
      (event) => {
        updatePointer(event);

        raycaster.setFromCamera(
          pointer,
          camera
        );

        const intersections =
          raycaster.intersectObjects(
            electrodeMeshesRef
              .current,
            false
          );

        if (
          intersections.length === 0
        ) {
          return;
        }

        const hit =
          intersections[0].object
            .userData;

        // Il click "blocca" l'osservazione sul sensore:
        // l'auto-rotate si ferma e torna disponibile il drag manuale.
        autoRotateEnabledRef.current =
          false;

        controls.autoRotate =
          false;

        controls.enableRotate =
          true;

        setIsAutoRotating(
          false
        );

        setSelectedElectrode({
          id: hit.electrodeId,
          value: hit.value,
        });
      };

    const handlePointerMove =
      (event) => {
        updatePointer(event);

        raycaster.setFromCamera(
          pointer,
          camera
        );

        const intersections =
          raycaster.intersectObjects(
            electrodeMeshesRef
              .current,
            false
          );

        if (
          intersections.length > 0
        ) {
          const hit =
            intersections[0].object
              .userData;

          const rect =
            renderer.domElement
              .getBoundingClientRect();

          const localX =
            event.clientX -
            rect.left;

          const localY =
            event.clientY -
            rect.top;

          setHoveredElectrode({
            id:
              hit.electrodeId,
            value:
              hit.value,
            x:
              Math.max(
                8,
                Math.min(
                  rect.width -
                    180,
                  localX + 14
                )
              ),
            y:
              Math.max(
                8,
                Math.min(
                  rect.height -
                    58,
                  localY + 14
                )
              ),
          });

          renderer.domElement
            .style.cursor =
            "pointer";
        } else {
          setHoveredElectrode(
            null
          );

          renderer.domElement
            .style.cursor =
            "grab";
        }
      };

    const handlePointerEnter =
      () => {
        // Se la testa sta ruotando, passare col mouse sul modello
        // la mette temporaneamente in pausa per facilitare l'ispezione.
        if (
          autoRotateEnabledRef
            .current
        ) {
          controls.autoRotate =
            false;
        }
      };

    const handlePointerLeave =
      () => {
        setHoveredElectrode(
          null
        );

        renderer.domElement
          .style.cursor =
          "grab";

        // Riprende solo se il pulsante Rotate è ancora attivo.
        if (
          autoRotateEnabledRef
            .current
        ) {
          controls.autoRotate =
            true;
        }
      };

    renderer.domElement
      .addEventListener(
        "pointerdown",
        handlePointerDown
      );

    renderer.domElement
      .addEventListener(
        "pointermove",
        handlePointerMove
      );

    renderer.domElement
      .addEventListener(
        "pointerenter",
        handlePointerEnter
      );

    renderer.domElement
      .addEventListener(
        "pointerleave",
        handlePointerLeave
      );

    const resize = () => {
      const width = Math.max(
        1,
        mount.clientWidth
      );

      const height = Math.max(
        1,
        mount.clientHeight
      );

      camera.aspect =
        width / height;

      camera
        .updateProjectionMatrix();

      renderer.setSize(
        width,
        height,
        false
      );
    };

    const resizeObserver =
      new ResizeObserver(
        resize
      );

    resizeObserver.observe(
      mount
    );

    resize();

    const animate = () => {
      controls.update();

      renderer.render(
        scene,
        camera
      );

      animationFrame =
        requestAnimationFrame(
          animate
        );
    };

    animate();

    return () => {
      disposed = true;

      if (animationFrame) {
        cancelAnimationFrame(
          animationFrame
        );
      }

      resizeObserver.disconnect();

      renderer.domElement
        .removeEventListener(
          "pointerdown",
          handlePointerDown
        );

      renderer.domElement
        .removeEventListener(
          "pointermove",
          handlePointerMove
        );

      renderer.domElement
        .removeEventListener(
          "pointerenter",
          handlePointerEnter
        );

      renderer.domElement
        .removeEventListener(
          "pointerleave",
          handlePointerLeave
        );

      controls.dispose();

      clearGroup(
        electrodeGroup
      );

      disposeObject(
        modelRootRef.current
      );

      scene.clear();

      renderer.dispose();

      renderer.forceContextLoss?.();

      if (
        renderer.domElement
          .parentNode === mount
      ) {
        mount.removeChild(
          renderer.domElement
        );
      }

      modelRootRef.current =
        null;

      mainHeadMeshRef.current =
        null;

      electrodeGroupRef.current =
        null;

      electrodeMeshesRef.current =
        [];

      resetViewRef.current =
        null;

      controlsRef.current =
        null;

      cameraRef.current =
        null;

      viewPresetsRef.current =
        {};

      autoRotateEnabledRef.current =
        false;

      modelBoundsRef.current =
        null;

      setModelReady(false);
    };
  }, []);

  // ================================================================
  // AUTO ROTATE
  // ================================================================
  useEffect(() => {
    const controls =
      controlsRef.current;

    if (!controls) {
      return;
    }

    autoRotateEnabledRef.current =
      isAutoRotating;

    controls.autoRotate =
      isAutoRotating;

    // Quando l'auto-rotate è attivo, il trascinamento manuale viene
    // disattivato per evitare conflitti; zoom e click restano disponibili.
    controls.enableRotate =
      !isAutoRotating;

    controls.update();
  }, [isAutoRotating]);

  // ================================================================
  // 2. AGGIORNAMENTO COLORI EEG E MARKER
  // ================================================================
  useEffect(() => {
    if (!modelReady) {
      return;
    }

    const mainMesh =
      mainHeadMeshRef.current;

    const electrodeGroup =
      electrodeGroupRef.current;

    const bounds =
      modelBoundsRef.current;

    const scale =
      modelScaleRef.current;

    const scalpOrigin =
      scalpOriginRef.current;

    if (
      !mainMesh ||
      !electrodeGroup ||
      !bounds ||
      !Number.isFinite(scale) ||
      scale <= 0
    ) {
      return;
    }

    const validSensors =
      sensors
        .filter(
          (sensor) =>
            sensor
              .calibratedPosition &&
            Number.isFinite(
              sensor.value
            )
        )
        .map((sensor) => {
          const position =
            sensor
              .calibratedPosition
              .clone()
              .multiplyScalar(
                scale
              );

          const direction =
            position
              .clone()
              .sub(
                scalpOrigin
              )
              .normalize();

          return {
            ...sensor,
            position,
            direction,
          };
        });

    /*
     * Vertex colors solo sulla mesh anatomica principale.
     */
    const colorAttribute =
      mainMesh.geometry
        .attributes.color;

    const directions =
      mainMesh.userData
        .scalpDirections;

    const blend =
      mainMesh.userData
        .scalpBlend;

    if (
      colorAttribute &&
      directions &&
      blend
    ) {
      const direction =
        new THREE.Vector3();

      for (
        let i = 0;
        i <
        colorAttribute.count;
        i++
      ) {
        direction.set(
          directions[i * 3],
          directions[
            i * 3 + 1
          ],
          directions[
            i * 3 + 2
          ]
        );

        const value =
          interpolateValue(
            direction,
            validSensors
          );

        const heatRgb =
          getScalpRgb({
            value,
            compareMode,
            absoluteScale,
            deltaScale,
          });

        const finalRgb =
          mixRgb(
            NEUTRAL_SURFACE,
            heatRgb,
            blend[i]
          );

        colorAttribute.setXYZ(
          i,
          finalRgb[0] / 255,
          finalRgb[1] / 255,
          finalRgb[2] / 255
        );
      }

      colorAttribute.needsUpdate =
        true;
    }

    /*
     * Marker: coordinate fisse realmente appartenenti alla superficie
     * della testa del modello fornito.
     */
    setHoveredElectrode(
      null
    );

    clearGroup(
      electrodeGroup
    );

    electrodeMeshesRef.current =
      [];

    const maxDimension =
      Math.max(
        bounds.size.x,
        bounds.size.y,
        bounds.size.z
      );

    const markerRadius =
      maxDimension * 0.0120;

    const markerThickness =
      maxDimension * 0.0030;

    const markerOffset =
      maxDimension * 0.0035;

    const cylinderAxis =
      new THREE.Vector3(0, 1, 0);

    validSensors.forEach(
      (sensor) => {
        const outward =
          sensor.direction.clone();

        /*
         * I marker ora assomigliano a piccoli elettrodi/pad appoggiati
         * sulla cute: guscio chiaro + centro colorato dalla BandPower.
         * Niente più sfere nere.
         */
        const orientation =
          new THREE.Quaternion()
            .setFromUnitVectors(
              cylinderAxis,
              outward
            );

        const markerPosition =
          sensor.position
            .clone()
            .addScaledVector(
              outward,
              markerOffset +
                markerThickness *
                  0.50
            );

        const valueRgb =
          getScalpRgb({
            value:
              sensor.value,
            compareMode,
            absoluteScale,
            deltaScale,
          });

        const valueColor =
          new THREE.Color(
            valueRgb[0] / 255,
            valueRgb[1] / 255,
            valueRgb[2] / 255
          );

        // Corpo esterno: piccolo supporto bianco/perla.
        const housing =
          new THREE.Mesh(
            new THREE.CylinderGeometry(
              markerRadius,
              markerRadius,
              markerThickness,
              32
            ),
            new THREE.MeshStandardMaterial({
              color: 0xf7f7f5,
              roughness: 0.30,
              metalness: 0.12,
            })
          );

        housing.position.copy(
          markerPosition
        );

        housing.quaternion.copy(
          orientation
        );

        housing.userData = {
          electrodeId:
            sensor.id,
          value:
            sensor.value,
        };

        // Disco centrale: mostra direttamente il colore del valore EEG.
        const signalDisc =
          new THREE.Mesh(
            new THREE.CylinderGeometry(
              markerRadius * 0.66,
              markerRadius * 0.66,
              markerThickness * 0.48,
              32
            ),
            new THREE.MeshStandardMaterial({
              color: valueColor,
              emissive:
                valueColor.clone(),
              emissiveIntensity:
                0.10,
              roughness: 0.38,
              metalness: 0.02,
            })
          );

        signalDisc.position
          .copy(markerPosition)
          .addScaledVector(
            outward,
            markerThickness *
              0.72
          );

        signalDisc.quaternion.copy(
          orientation
        );

        // Anello sottile che separa visivamente il centro dal supporto.
        const rim =
          new THREE.Mesh(
            new THREE.TorusGeometry(
              markerRadius * 0.78,
              markerRadius * 0.055,
              8,
              32
            ),
            new THREE.MeshStandardMaterial({
              color: 0xb8b8b2,
              roughness: 0.34,
              metalness: 0.28,
            })
          );

        // TorusGeometry è orientata sul piano XY, quindi il suo asse
        // normale locale è Z anziché Y.
        const torusOrientation =
          new THREE.Quaternion()
            .setFromUnitVectors(
              new THREE.Vector3(
                0,
                0,
                1
              ),
              outward
            );

        rim.position
          .copy(markerPosition)
          .addScaledVector(
            outward,
            markerThickness *
              0.98
          );

        rim.quaternion.copy(
          torusOrientation
        );

        electrodeGroup.add(
          housing
        );

        electrodeGroup.add(
          signalDisc
        );

        electrodeGroup.add(
          rim
        );

        // Il supporto esterno rimane la superficie cliccabile principale.
        electrodeMeshesRef.current
          .push(housing);
      }
    );

    setSelectedElectrode(
      (previous) => {
        if (!previous) {
          return previous;
        }

        return {
          id: previous.id,

          value:
            electrodeValues?.[
              previous.id
            ] ?? null,
        };
      }
    );
  }, [
    modelReady,
    sensors,
    electrodeValues,
    compareMode,
    absoluteScale.min,
    absoluteScale.max,
    deltaScale.maxAbs,
  ]);

  const applyViewPreset =
    (presetName) => {
      const camera =
        cameraRef.current;

      const controls =
        controlsRef.current;

      const preset =
        viewPresetsRef.current?.[
          presetName
        ];

      if (
        !camera ||
        !controls ||
        !preset
      ) {
        return;
      }

      setIsAutoRotating(
        false
      );

      autoRotateEnabledRef.current =
        false;

      controls.autoRotate =
        false;

      controls.enableRotate =
        true;

      camera.up.copy(
        preset.up
      );

      camera.position.copy(
        preset.position
      );

      controls.target.copy(
        preset.target
      );

      controls.update();
    };

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <p className="text-[10px] text-[#8a8a85] uppercase tracking-wider font-bold">
          {isAutoRotating
            ? "Automatic clockwise rotation · wheel to zoom · click an electrode pad"
            : "Drag to rotate · wheel to zoom · click an electrode pad"}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-full border border-[#ececea] bg-white p-0.5">
            {[
              ["front", "Front"],
              ["top", "Top"],
              ["back", "Back"],
            ].map(
              ([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() =>
                    applyViewPreset(
                      key
                    )
                  }
                  disabled={
                    !modelReady
                  }
                  className="px-2.5 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider text-[#6b6b66] hover:bg-[#fafaf8] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {label}
                </button>
              )
            )}
          </div>

          <button
            type="button"
            onClick={() =>
              setIsAutoRotating(
                (current) => !current
              )
            }
            disabled={!modelReady}
            aria-pressed={isAutoRotating}
            className={`px-3 py-1.5 rounded-full border text-[10px] font-bold uppercase tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
              isAutoRotating
                ? "bg-[#111111] border-[#111111] text-white"
                : "bg-white border-[#ececea] text-[#6b6b66] hover:bg-[#fafaf8]"
            }`}
          >
            {isAutoRotating
              ? "Stop Rotate"
              : "Rotate"}
          </button>

          <button
            type="button"
            onClick={() => {
              setIsAutoRotating(
                false
              );
              autoRotateEnabledRef.current =
                false;
              resetViewRef.current?.();
            }}
            disabled={!modelReady}
            className="px-3 py-1.5 rounded-full border border-[#ececea] bg-white text-[10px] font-bold uppercase tracking-wider text-[#6b6b66] hover:bg-[#fafaf8] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Reset view
          </button>
        </div>
      </div>

      <div className="relative w-full h-[520px] rounded-2xl overflow-hidden border border-[#ececea] bg-[#fafaf8]">
        <div
          ref={mountRef}
          className="absolute inset-0"
        />

        {!modelReady &&
          !modelError && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="px-4 py-2 rounded-full bg-white/90 border border-[#ececea] text-[10px] font-bold uppercase tracking-wider text-[#6b6b66]">
                Loading scalp.glb…
              </div>
            </div>
          )}

        {modelError && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="max-w-md bg-white border border-red-200 rounded-2xl p-5 text-center shadow-sm">
              <p className="text-sm font-black text-red-700 mb-2">
                3D model not available
              </p>

              <p className="text-xs text-[#6b6b66] leading-relaxed">
                {modelError}
              </p>
            </div>
          </div>
        )}

        {hoveredElectrode && (
          <div
            className="absolute z-10 pointer-events-none rounded-xl border border-[#deded8] bg-white/95 px-3 py-2 shadow-sm backdrop-blur-sm"
            style={{
              left:
                hoveredElectrode.x,
              top:
                hoveredElectrode.y,
            }}
          >
            <div className="text-[10px] font-black text-[#111111]">
              {
                hoveredElectrode.id
              }
            </div>

            <div className="mt-0.5 text-[10px] text-[#6b6b66]">
              {selectedBand}:{" "}
              <span className="font-mono font-bold text-[#111111]">
                {Number.isFinite(
                  hoveredElectrode.value
                )
                  ? hoveredElectrode.value.toFixed(
                      4
                    )
                  : "N/A"}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 min-h-[38px] flex items-center justify-center">
        {selectedElectrode ? (
          <div className="px-4 py-2 rounded-full bg-[#fafaf8] border border-[#ececea] text-xs">
            <span className="font-black text-[#111111]">
              {
                selectedElectrode.id
              }
            </span>

            <span className="text-[#8a8a85]">
              {" · "}
              {selectedBand}:{" "}
            </span>

            <span className="font-mono font-bold text-[#111111]">
              {Number.isFinite(
                selectedElectrode.value
              )
                ? selectedElectrode.value.toFixed(
                    4
                  )
                : "N/A"}
            </span>
          </div>
        ) : (
          <p className="text-[10px] text-[#8a8a85] text-center">
            Select an electrode to inspect its measured phase average.
          </p>
        )}
      </div>

      <p className="text-[10px] text-[#8a8a85] text-center mt-2 leading-relaxed max-w-[760px] mx-auto">
        The anatomical orientation is derived directly from the local
        coordinate system of scalp.glb. The 14 EPOC X electrodes are
        calibrated on the cranial surface; EEG colors are restricted to
        the scalp while face and neck remain neutral.
      </p>
    </div>
  );
}
