import pandas as pd
import time
from cortex import Cortex

class Subcribe():
    def __init__(self, app_client_id, app_client_secret, **kwargs):
        self.c = Cortex(app_client_id, app_client_secret, debug_mode=False, **kwargs)
        self.c.bind(create_session_done=self.on_create_session_done)
        self.c.bind(new_data_labels=self.on_new_data_labels)
        self.c.bind(new_eeg_data=self.on_new_eeg_data)
        self.c.bind(new_mot_data=self.on_new_mot_data)
        self.c.bind(new_met_data=self.on_new_met_data)
        self.c.bind(new_pow_data=self.on_new_pow_data)
        self.c.bind(inform_error=self.on_inform_error)

        self.eeg_buffer = []
        self.mot_buffer = []
        self.met_buffer = []x
        self.pow_buffer = []
        self.labels = {} # Memorizza le intestazioni delle colonne

    def start(self, streams, headset_id=''):
        self.streams = streams
        if headset_id != '':
            self.c.set_wanted_headset(headset_id)
        self.c.open()

    def sub(self, streams):
        self.c.sub_request(streams)

    def on_new_data_labels(self, *args, **kwargs):
        data = kwargs.get('data')
        stream_name = data['streamName']
        self.labels[stream_name] = data['labels']
        print(f"Etichette salvate per {stream_name}")

    def on_new_eeg_data(self, *args, **kwargs):
        self.eeg_buffer.append(kwargs.get('data'))

    def on_new_mot_data(self, *args, **kwargs):
        self.mot_buffer.append(kwargs.get('data'))

    def on_new_met_data(self, *args, **kwargs):
        self.met_buffer.append(kwargs.get('data'))

    def on_new_pow_data(self, *args, **kwargs):
        self.pow_buffer.append(kwargs.get('data'))

    def on_create_session_done(self, *args, **kwargs):
        print('Sessione creata. Dati in acquisizione...')
        self.sub(self.streams)

    def on_inform_error(self, *args, **kwargs):
        print(kwargs.get('error_data'))

    def save_to_excel(self):
        print("\nSalvataggio in Excel con intestazioni...")
        with pd.ExcelWriter('dati_emotiv_ordinati.xlsx') as writer:
            if self.eeg_buffer and 'eeg' in self.labels:
                df = pd.DataFrame([r['eeg'] for r in self.eeg_buffer], columns=self.labels['eeg'])
                df['time'] = [r['time'] for r in self.eeg_buffer]
                df.to_excel(writer, sheet_name='EEG', index=False)

            if self.mot_buffer and 'mot' in self.labels:
                df = pd.DataFrame([r['mot'] for r in self.mot_buffer], columns=self.labels['mot'])
                df['time'] = [r['time'] for r in self.mot_buffer]
                df.to_excel(writer, sheet_name='Motion', index=False)

            if self.met_buffer and 'met' in self.labels:
                df = pd.DataFrame([r['met'] for r in self.met_buffer], columns=self.labels['met'])
                df['time'] = [r['time'] for r in self.met_buffer]
                df.to_excel(writer, sheet_name='Performance', index=False)

            if self.pow_buffer and 'pow' in self.labels:
                df = pd.DataFrame([r['pow'] for r in self.pow_buffer], columns=self.labels['pow'])
                df['time'] = [r['time'] for r in self.pow_buffer]
                df.to_excel(writer, sheet_name='BandPower', index=False)

        print("Fatto. File 'dati_emotiv_ordinati.xlsx' pronto.")

def main():
    your_app_client_id = 'spVJctZiBaM5PgrDbrUpCSajYUFHddbZ7lXuUmLf'
    your_app_client_secret = '8tOKbQyYvCpCqZrhHtlbIUjP8yB9uK7YZHmWTlrxtPbEvJZuTk0yWEAd9TFXrq8zdWRwxyWYmVtMswlIpcLVTC1pCMfphOKs4FMHFhNkftKfvH5wm4tTrw6V0nnUUaHi'

    s = Subcribe(your_app_client_id, your_app_client_secret)
    try:
        s.start(['mot','met','pow'])
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        s.save_to_excel()

if __name__ =='__main__':
    main()
