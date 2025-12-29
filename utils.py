import base64


def atob_decode(encoded):
    try:
        decoded_bytes = base64.b64decode(encoded)
        return decoded_bytes.decode('utf-8')
    except:
        return encoded


def replace_emoticons(text):
    emoticons = {
        ':)': '<span class="emoji">😊</span>',
        ':(': '<span class="emoji">😢</span>',
        ':D': '<span class="emoji">😃</span>',
        ';)': '<span class="emoji">😉</span>',
        ':P': '<span class="emoji">😛</span>',
        '<3': '<span class="emoji">❤️</span>',
    }

    for old, new in emoticons.items():
        text = text.replace(old, new)

    return text