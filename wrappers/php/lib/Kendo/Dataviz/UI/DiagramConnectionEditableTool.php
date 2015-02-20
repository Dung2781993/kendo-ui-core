<?php

namespace Kendo\Dataviz\UI;

class DiagramConnectionEditableTool extends \Kendo\SerializableObject {
//>> Properties

    /**
    * The name of the tool. The built-in tools are "edit" and "delete".
    * @param string $value
    * @return \Kendo\Dataviz\UI\DiagramConnectionEditableTool
    */
    public function name($value) {
        return $this->setProperty('name', $value);
    }

//<< Properties
}

?>
