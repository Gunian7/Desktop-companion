import os
import sys


def main():
    if len(sys.argv) < 4:
        print("ASR_RESULT:")
        return

    sovits_root = sys.argv[1]
    audio_path = sys.argv[2]
    language = sys.argv[3]

    os.chdir(sovits_root)
    sys.path.insert(0, sovits_root)

    from tools.asr.funasr_asr import only_asr

    text = only_asr(audio_path, language) or ""
    text = text.replace("\r", " ").replace("\n", " ").strip()
    print(f"ASR_RESULT:{text}")


if __name__ == "__main__":
    main()
