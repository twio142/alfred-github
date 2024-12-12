'use strict';

class Workflow {
  items = [];
  variables = {};
  // #debug = !!process.env.alfred_debug;

  filter(str = '') {
    this.items = this.items.filter((item) =>
      (item.match || item.title)
        .toLowerCase()
        .split(' ')
        .find((x) => x.startsWith(str.toLowerCase())),
    );
  }

  addItem(item) {
    this.items.push(item);
  }

  setVar(key, value) {
    this.variables[key] = value;
  }

  warnEmpty(title, subtitle) {
    this.items = [
      {
        title,
        subtitle,
        valid: false,
        icon: {
          path: `${process.env.alfred_preferences || '../..'}/resources/AlertCautionIcon.icns`,
        },
        text: { largetype: title },
      },
    ];
  }

  output() {
    console.log(
      JSON.stringify({
        items: this.items,
        variables: this.variables,
      }),
    );
  }
}

export default Workflow;
