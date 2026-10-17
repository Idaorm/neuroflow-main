# Eye-Tracking & EEG Analytics Platform

Questa applicazione integra il tracciamento oculare (Eye Tracking Tobii) con il monitoraggio dell'attività cerebrale (Headset EEG Emotiv) per condurre studi di Neuromarketing e User Experience (UX). Il sistema permette di capire sia dove l'utente sta guardando (tramite mappe di calore e percorsi visivi), sia cosa sta provando a livello cognitivo (attenzione, stress, focus e bande di frequenza).

---

## Collegamento all'Headset Emotiv

La comunicazione con il caschetto EEG è gestita attraverso un'architettura client-server locale basata sul protocollo WebSocket.

Nello specifico:
- server.py : è un server locale gira in background e fa da ponte diretto con le API ufficiali (Cortex) del caschetto Emotiv.
- **Client di Connessione (`services.py`)**: L'applicazione si appoggia a questo file Python per connettersi al server via WebSocket (`ws://localhost:8765`). Tramite questa tecnologia bidirezionale, il sistema invia pacchetti dati in formato JSON per inserire marcatori temporali (inizio/fine stimolo) e per scaricare i report finali con l'analisi delle onde cerebrali, garantendo una sincronizzazione immediata e senza ritardi.